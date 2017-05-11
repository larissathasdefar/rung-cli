import dasherize from 'dasherize';
import { resolve } from 'bluebird';
import {
    T,
    always,
    cond,
    equals,
    identity,
    join,
    map,
    pipe,
    toPairs,
    type
} from 'ramda';
import { transform } from 'babel-core';

/**
 * Generates CSS string from an object
 *
 * @param {Object} obj
 * @return {String}
 */
const compileCSS = pipe(
    toPairs,
    map(([key, value]) => `${dasherize(key)}:${value}`),
    join(';'),
    JSON.stringify
);

/**
 * Generates HTML string for element properties
 *
 * @param {Object} props
 * @return {String}
 */
function compileProps(props) {
    const transformKey = cond([
        [equals('className'), always('class')],
        [T, dasherize]
    ]);
    const transformValue = cond([
        [item => type(item) === 'Object', compileCSS],
        [T, JSON.stringify]
    ]);
    const stringify = pipe(
        toPairs,
        map(([key, value]) => `${transformKey(key)}=${transformValue(value)}`),
        join(' ')
    );
    const result = stringify(props);

    return result.length === 0 ? '' : ` ${result}`;
}

/**
 * Generates HTML source code directly from JSX
 *
 * @param {String} tag - JSX component name
 * @param {Object} props - Element properties
 * @param {Array} children - Items to append to inner component
 * @return {String}
 */
export function compileHTML(tag, props, ...children) {
    const filteredTag = cond([
        [equals('script'), always('span')],
        [equals('style'), always('span')],
        [T, identity]
    ])(tag);

    return children.length === 0
        ? `<${filteredTag}${compileProps(props)} />`
        : `<${filteredTag}${compileProps(props)}>${children.join('')}</${filteredTag}>`;
}

/**
 * Precompiles ES6 source to ES5 in order to keep retrocompatibily
 *
 * @author Marcelo Haskell Camargo
 * @param {String} source
 * @return {Promise}
 */
export function compile(source) {
    const result = transform(source, {
        comments: false,
        compact: true,
        presets: ['es2015', 'react'],
        plugins: [
            ['transform-react-jsx', { pragma: 'render' }]
        ]
    });

    return resolve(result.code);
}
