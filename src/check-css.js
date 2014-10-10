;
/**
 *  Copyright 2014 Zalando SE
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
**/

'use strict';

var gutil = require( 'gulp-util' ),     // for gulp plugin error
    through = require( 'through2' ),    // stream library
    css = require( 'css' ),             // css parser
    fs = require( 'fs' ),               // file system access
    glob = require( 'glob' ),           // to read globs like src/main/webapp/**/*.html
    Q = require( 'q' ),                 // promise implementation
    html = require( 'htmlparser2' ),    // html parser,
    _ = require( 'lodash' ),            // lodash for utilities

    Regular = require( './collector/regular' ),
    regularClass = new Regular(),

    Angular = require( './collector/angular' ),
    angularClass = new Angular(),

    PLUGIN_NAME = 'gulp-check-unused-css';

var definedClasses = [],
    usedClasses = [],
    CLASS_REGEX = /\.[a-zA-Z](?:[0-9A-Za-z_-])+/g;  // leading dot followed by a letter followed by digits, letters, _ or -

// checks whether a class should be ignored
function shouldIgnore( clazz ) {
    return function( ignoreRule ) {
        if ( _.isRegExp( ignoreRule ) ) {
            return ignoreRule.test( clazz );
        }
        if ( _.isString( ignoreRule ) ) {
            return ignoreRule === clazz;
        }
        return true;
    }
}

// checks if the selectors of a CSS rule are a class
// an adds them to the defined classes
function getClasses( rule, idx ) {
    if ( !rule.type === 'rule ' ) {
        return;
    }
    
    if ( !rule.selectors ) {
        return;
    }

    rule.selectors.forEach( function( selector ) {
        var matches = selector.match( CLASS_REGEX );
        if ( !matches ) {
            return;
        }

        matches.forEach( function( match ) {
            if ( definedClasses.indexOf( match ) === -1 ) {
                definedClasses.push( match );
            }
        });
    });
}

// actual function that gets exported
function checkCSS( opts ) {

    if ( typeof opts === 'undefined' ) {
        opts = {};
    }

    // create html parser
    var htmlparser = new html.Parser({
        onopentag: function onopentag( name, attribs ) {
            var all = [];
            
            all.push.apply( all, regularClass.collect( attribs ) );
            if ( opts.angular !== false ) {
                all.push.apply( all, angularClass.collect( attribs ) );
            }

            all.forEach( function( usedClass ) {
                if ( usedClasses.indexOf( usedClass ) === -1 ) {
                    usedClasses.push( usedClass );
                }
            });
        }
    });

    var files,
        ignore = opts.ignore || false,
        filesRead = Q.defer();  // resolves when all files are read by glob

    if ( opts.files ) {

        glob( opts.files, null, function( err, globFiles ) {
            // put all files in html parser
            globFiles.forEach( function( filename ) {
                var file = fs.readFileSync( filename, 'utf8' );
                htmlparser.write( file );
            });

            filesRead.resolve();
        });
    } else {
        // throw an error if there are no html files configured
        throw new gutil.PluginError( PLUGIN_NAME, 'No HTML files specified' );
    }

    return through.obj( function( file, enc, done ) {
        var self = this,
            doneCalled = false;

        if ( file.isNull() ) {
            self.push( file );
            doneCalled = true;
            return done();
        }

        if ( file.isStream()) {
            doneCalled = true;
            return done( new gutil.PluginError( PLUGIN_NAME, 'Streaming not supported' ) );
        }

        filesRead.promise.then( function() {
            // check if done was already called before
            if ( doneCalled ) {
                return;
            }

            // parse css content
            var ast,
                unused = [];

            try {
                ast = css.parse( String( file.contents ), { silent: false } );
            } catch( cssError ) {
                if ( opts.end ) {
                    return done();
                } else {
                    return done( cssError );
                }
            }

            definedClasses = [];

            // find all classes in CSS
            if ( ast.stylesheet ) {
                ast.stylesheet.rules.forEach( getClasses );
            }
            
            unused = definedClasses
                        // remove leading dot because that's not in the html
                        .map( function( classdef ) {
                            return classdef.substring( 1 );
                        })
                        // filter unused
                        .filter( function( definedClass ) {
                            var ignoreThis = false;
                            // check if we should ignore this class by classname
                            if ( ignore ) {
                                ignoreThis = ignore.some( shouldIgnore( definedClass ) );
                            }
                            return ignoreThis ?
                                        false :
                                        usedClasses.indexOf( definedClass ) === -1;
                        });

            // throw an error if there are unused defined classes
            if ( definedClasses.length > 0 && unused.length > 0 ) {
                var classString = unused.join( ' ' );
                gutil.log.apply( gutil, [ gutil.colors.cyan( 'Unused CSS classes' ), gutil.colors.red( file.path ), classString ] );

                if ( opts.end ) {
                    self.emit( 'end' );
                    return done();
                } else {
                    var error = new Error( 'Unused CSS Classes: ' + classString );
                    error.unused = unused;
                    return done( new gutil.PluginError( PLUGIN_NAME, error ) );
                }
            }

            // else proceed
            // gutil.log.apply( gutil, [ gutil.colors.cyan( 'File okay' ), file.path ]);
            self.push( file );
            done();
        });
    });
}

module.exports = checkCSS;