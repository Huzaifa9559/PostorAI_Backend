const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Post extends Model {
    static associate(models) {
      Post.belongsTo(models.User, { foreignKey: "user_id" });
      Post.hasMany(models.PostMedia, { foreignKey: "post_id", as: "media" });
      Post.hasMany(models.PostPlatform, {
        foreignKey: "post_id",
        as: "post_platforms",
      });
    }
  }

  Post.init(
    {
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      title: {
        type: DataTypes.TEXT("tiny"),
        allowNull: false,
      },
      desc: {
        type: DataTypes.TEXT("medium"),
      },
      hashtags: {
        type: DataTypes.TEXT("tiny"),
      },
      platforms: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      scheduled_at: {
        type: DataTypes.DATE,
        allowNull: true, // null means post instantly
      },
      post_status: {
        type: DataTypes.BOOLEAN,
        allowNull: true, // null means post instantly
      }
    },
    {
      sequelize,
      tableName: "posts",
      underscored: true,
    }
  );

  return Post;
};
