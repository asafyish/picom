'use strict';

var gulp = require('gulp');
var plugins = require('gulp-load-plugins')();

gulp.task('lint', function () {
	return gulp.
		src(['gulpfile.js', './src/**/*.js', './test/**/*.js']).
		pipe(plugins.eslint()).
		pipe(plugins.eslint.format('stylish'));
});

gulp.task('test', function (cb) {
	return gulp.
		src(['src/**/*.js']).
		pipe(plugins.istanbul()).
		pipe(plugins.istanbul.hookRequire()).
		on('finish', function () {
			return gulp.
				src(['test/*.js']).
				pipe(plugins.mocha({reporter: 'nyan'})).
				pipe(plugins.istanbul.enforceThresholds({thresholds: {global: 90}})).
				once('error', function () {
					process.exit(1);
				}).
				once('end', cb);
		});
});

gulp.task('default', ['lint', 'test']);
