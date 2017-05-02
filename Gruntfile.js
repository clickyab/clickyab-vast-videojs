module.exports = function(grunt) {
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    uglify: {
      options: {
        mangle: false,
        beautify: false
      },
      my_target: {
        files: {
          'dist/videojs-vast.js': [
            'src/fingerprint.js',
            'js/vmap-client-js/vmap-client.js',
            'js/vast-client-js/vast-client.js',
            'bower_components/videojs-contrib-ads/src/videojs.ads.js',
            'src/videojs-vmap-clickyab.js'
          ]
        }
      }
    }
  });
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.registerTask('default', ['uglify']);
};
