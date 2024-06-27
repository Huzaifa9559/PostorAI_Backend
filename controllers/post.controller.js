const { Op } = require("sequelize");
const schedule = require("node-schedule");
const { GROQ_API_KEY } = require("../utils/constants");
const { Post, PostMedia, User, sequelize } = require("../models");
const {
  postToSocialMedia,
  uploadPostToPlatform,
} = require("../services/social-media-service");
const { api, parallel, uploadFileToS3 } = require("../utils/helpers");
const upload = require("../middlewares/multer");
const { default: Groq } = require("groq-sdk");

const groq = new Groq({ apiKey: GROQ_API_KEY });

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @returns
 */
module.exports.createPost = async (req, res) => {
  try {
    const {
      content,
      media_urls: mediaUrls,
      user_id: userId,
      scheduled_at: scheduledAt = null,
    } = req.body;

    const post = await Post.create({
      user_id: userId,
      content,
      scheduled_at: scheduledAt,
    });

    if (mediaUrls && mediaUrls.length > 0) {
      const postMedia = mediaUrls.map((url) => ({
        post_id: post.id,
        media_url: url,
        media_type: url.endsWith(".mp4") ? "video" : "image",
      }));

      await PostMedia.bulkCreate(postMedia);
    }

    if (scheduledAt) {
      schedule.scheduleJob(new Date(scheduledAt), () =>
        postToSocialMedia(post, userId)
      );
      return res.status(201).json({ message: "Post scheduled successfully." });
    } else {
      await postToSocialMedia(post, userId);
      return res
        .status(201)
        .json({ message: "Post created and shared successfully." });
    }
  } catch (error) {
    console.error("Error creating post:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

async function uploadPostsToPlatforms(platforms, post, files) {
  return [];
  const platformResponses = await parallel(platforms, (platform) =>
    uploadPostToPlatform(platform, post, files)
  );
  const postPlatforms = [];
  for (const platformResponse of platformResponses) {
    if (platformResponse.id) {
      postPlatforms.push({
        post_id: post.id,
        platform_type: platformResponse.platform,
        platform_post_id: platformResponse.id,
      });
    } else {
      // postPlatforms.push({
      //   platform_type: platformResponse.platform,
      //   error: platformResponse.error,
      // });
    }
  }
  return postPlatforms;
}

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @returns
 */
module.exports.createPosts = async (req, res) => {
  const {
    user_id: userId = req.user.id,
    title,
    desc,
    scheduled_at: scheduledAt,
  } = req.body;
  const files = req.files;
  
  const hashtags = JSON.parse(req.body.hashtags || "[]");
  const platforms = JSON.parse(req.body.platforms || "[]");
  // return res.json({ success: true, message: "OKAY" });

  const transaction = await sequelize.transaction();
  try {
    let post = await Post.create(
      {
        user_id: userId,
        title,
        desc,
        hashtags: hashtags.join(","),
        scheduled_at: scheduledAt,
        platforms: JSON.stringify(platforms),
      },
      { transaction }
    );
    post = post.get({ plain: true });
    const postMedias = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const s3Url = await uploadFileToS3(
          `${userId}/${Date.now()}-${file.originalname}`,
          file.path
        );
        if (s3Url) {
          const postMedia = await PostMedia.create(
            {
              post_id: post.id,
              media_url: s3Url,
              media_type: file.mimetype.includes("video") ? "video" : "image",
            },
            {
              transaction,
            }
          );
          postMedias.push(postMedia.get({ plain: true }));
        } else {
          return res.status(400).json({
            successs: false,
            message: "Failed to upload your media files to AWS",
          });
        }
      }
    }
    post.post_medias = [...postMedias];
    if (!scheduledAt) {
      const postPlatformsBody = await uploadPostsToPlatforms(
        platforms,
        post,
        files
      );
      if (postPlatformsBody.length) {
        await PostPlatform.bulkCreate(postPlatformsBody, { transaction });
      }
    } else {
      schedule.scheduleJob(new Date(scheduledAt), async () => {
        const postPlatformsBody = await uploadPostsToPlatforms(
          platforms,
          post,
          files
        );
        if (postPlatformsBody.length) {
          await PostPlatform.bulkCreate(postPlatformsBody);
        }
      });
    }
    await transaction.commit();
    return res
      .status(201)
      .json({ success: true, post, message: "Posts made successfully" });
  } catch (error) {
    console.error(error);
    await transaction.rollback();
    return res.status(500).json({ error: "Failed to create post" });
  }
};

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @returns
 */
module.exports.getPosts = (req, res) =>
  api(res, async () => {
    const { scheduled_at: scheduledAt, ...qParams } = req.query;
    const where = { ...qParams };
    where.scheduled_at = scheduledAt
      ? new Date(scheduledAt)
      : { [Op.ne]: null };
    const posts = await Post.findAll({
      where: where,
      include: {
        model: PostMedia,
        as: "media",
      },
    });
    return res.json({ success: true, data: posts });
  });

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @returns
 */
module.exports.getPost = (req, res) =>
  api(res, async () => {
    const post = await Post.findAll({
      where: { id: req.params.id },
      include: {
        model: PostMedia,
        as: "media",
      },
    });
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post Not Found!",
      });
    }
    return res.json({ success: true, data: post });
  });

/**
 * Generate Caption
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @returns
 */
module.exports.generateCaption = (req, res) =>
  api(res, async () => {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: "Title is missing in the body" });
    }
    const prompt = `I'll give you a JSON object which stores either 'title' key or a 'desc' key. Based on it's content, I need you to give me a JSON object with the following keys: 'title' (255 characters max), 'desc' (1000 words max), 'hashtags' (8 max, an array, each item within it having '#' in the beginning). Generate the description based on title and vice versa in case it's missing. Your response should not have anything except this JSON object, don't enclose it in triple backticks either. The object: ${JSON.stringify(
      req.body
    )}`;
    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama3-8b-8192",
    });
    console.log(JSON.stringify(response.choices[0]?.message?.content));
    const data = JSON.parse(response.choices[0]?.message?.content || "");
    return res.json({ success: true, data });
  });
