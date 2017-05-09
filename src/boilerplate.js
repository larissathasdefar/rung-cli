import fs from 'fs';
import path from 'path';
import { promisify, reject, resolve } from 'bluebird';
import {
    append,
    assoc,
    dropWhile,
    equals,
    join,
    juxt,
    merge,
    pick,
    pipe,
    replace
} from 'ramda';
import { IO } from './input';
import { askQuestions } from './init';

const createFolder = promisify(fs.mkdir);
const createFile = promisify(fs.writeFile);

/**
 * Formats a formatted String
 *
 * @param {String} source
 * @return {String}
 */
const format = pipe(
    replace(/\n {8}/g, '\n'),
    dropWhile(equals('\n')),
    append('\n'),
    join('')
);

/**
 * Creates a file with the passed content. Receives the format
 * { filename :: String, content :: String }
 *
 * @param {Object} {filename, content}
 * @return {Promise}
 */
function writeFileFromObject({ filename, content }) {
    return createFile(filename, content)
        .catch(() => reject(`Unable to create file ${filename}`));
}

/**
 * Creates the folder for the boilerplate based on package name. If the folder
 * already exists, throw an error
 * Queria estar morta
 *
 * @param {Object} answers
 * @return {Promise}
 */
function createBoilerplateFolder(answers) {
    return createFolder(answers.name)
        .catch(() => reject(`Unable to create folder ${answers.name}`))
        .thenReturn(answers);
}

/**
 * Returns an object in the format { filename :: String, content :: String }
 * containing meta-informations about the file
 *
 * @param {Object} answers
 * @return {Object}
 */
function getPackageMetaFile(answers) {
    const packageFields = ['name', 'version', 'description', 'license', 'main', 'category'];
    const rungFields = ['title'];

    const packageObject = merge(
        assoc('rung', merge(pick(rungFields, answers), {
            preview: 'Hello, Trixie!' }), pick(packageFields, answers)),
        { dependencies: { 'rung-sdk': '^1.0.6' } });

    return {
        filename: path.join(answers.name, 'package.json'),
        content: JSON.stringify(packageObject, null, 2) };
}

/**
 * Content about README.md file
 *
 * @param {Object} answers
 * @return {Object}
 */
function getReadMeMetaFile(answers) {
    const content = format(`
        # Rung ─ ${answers.title}

        # Development

        - Use \`yarn\` to install the dependencies
        - Use \`rung run\` to start the CLI wizard
    `);

    return {
        filename: path.join(answers.name, 'README.md'),
        content };
}

/**
 * Content about index.js file
 *
 * @param {Object} answers
 * @return {Object}
 */
function getIndexFile(answers) {
    const content = format(`
        const { create } = require('rung-sdk');
        const { String: Text } = require('rung-sdk/dist/types');

        function main(context) {
            const { name } = context.params;
            return [\`Hello, \${name}!\`];
        }

        const params = {
            name: {
                description: 'What is your name?',
                type: Text
            }
        };

        const app = create(main, { params });
        module.exports = app;
    `);

    return {
        filename: path.join(answers.name, 'index.js'),
        content };
}

/**
 * Creates a boilerplate project
 *
 * @return {Promise}
 */
export default function boilerplate() {
    const io = IO();
    return askQuestions(io)
        .then(createBoilerplateFolder)
        .then(juxt([getPackageMetaFile, getReadMeMetaFile, getIndexFile]))
        .map(writeFileFromObject)
        .finally(io.close.bind(io));
}