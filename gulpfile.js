'use strict';

var gulp = require('gulp');
var plugins = require('gulp-load-plugins')();

gulp.task('lint', function () {
	return gulp.src(['gulpfile.js', './src/*.js', './test/*.js'])
		.pipe(plugins.eslint())
		.pipe(plugins.eslint.format('stylish'));
});

gulp.task('test', function () {
	return gulp.src('test/test.js', {read: false})
		.pipe(plugins.mocha({reporter: 'nyan'}));
});

gulp.task('default', function () {

});
