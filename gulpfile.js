'use strict';

/* eslint no-var: 0 */
var gulp = require('gulp');
var plugins = require('gulp-load-plugins')();

gulp.task('lint', function () {
	return gulp
		.src(['gulpfile.js', './examples/**/*.js', './lib/**/*.js', './test/**/*.js'])
		.pipe(plugins.eslint())
		.pipe(plugins.eslint.format('stylish'));
});

gulp.task('pre-test', function () {
	return gulp
		.src(['lib/**/*.js'])
		.pipe(plugins.istanbul())
		.pipe(plugins.istanbul.hookRequire());
});

gulp.task('test', ['pre-test'], function () {
	return gulp
		.src(['test/**/*.js'])
		.pipe(plugins.mocha({reporter: 'nyan'}))
		.pipe(plugins.istanbul.writeReports())
		.pipe(plugins.istanbul.enforceThresholds({thresholds: {global: 90}}));
});

gulp.task('default', ['lint', 'test']);
