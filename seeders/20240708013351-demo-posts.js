'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Generate 100 sample posts
    const posts = [];
    const currentDate = new Date();

    for (let i = 0; i < 10; i++) {
      posts.push({
        user_id: 1,
        title: `Sample Post Title ${i + 1}`,
        desc: `This is a medium description for the sample post ${i + 1}.`,
        hashtags: `#sample #post${i + 1}`,
        platforms: JSON.stringify({ platform1: 'Twitter', platform2: 'Facebook' }),
        scheduled_at:currentDate,
        post_status: i % 2 == 0 ? true : null,
        created_at: currentDate,
        updated_at: currentDate
      });
    }

    await queryInterface.bulkInsert('Posts', posts, {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('Posts', null, {});
  }
};
