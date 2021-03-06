import os from 'os';
import fs from 'fs';
import path from 'path';
import { promisify, reject, resolve } from 'bluebird';
import rimraf from 'rimraf';
import {
    T,
    cond,
    equals,
    pipe,
    prop,
    tryCatch,
    type
} from 'ramda';
import { render } from 'prettyjson';

const rm = promisify(rimraf);
const createFolder = promisify(fs.mkdir);
const createFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

/**
 * Marshalls the JS input
 *
 * @param {Mixed} input
 * @return {Promise}
 */
function serialize(input) {
    const value = JSON.stringify(input);
    return value === undefined
        ? reject(new Error(`Unsupported type ${type(input)}`))
        : resolve(value);
}

/**
 * Gets the location of a database file
 *
 * @param {String} name - Database name
 * @return {String}
 */
function location(name) {
    return path.join(os.homedir(), '.rung', `${name}.db`);
}

/**
 * Clears a database file by removing it
 *
 * @param {String} name - Database name
 * @return {Promise}
 */
export function clear(name) {
    return rm(location(name));
}

/**
 * Creates or updates a database file
 *
 * @param {String} name - Database name
 * @param {Mixed} store - Content to save
 * @return {Promise}
 */
export function upsert(name, store) {
    // When store is undefined, drop the file
    return store === undefined
        ? resolve()
        : resolveRungFolder()
            .then(() => serialize(store))
            .then(value => createFile(location(name), value));
}

/**
 * Reads data from database file
 *
 * @param {String} name
 * @return {Promise}
 */
export function read(name) {
    const file = location(name);
    return readFile(file, 'utf-8')
        .then(JSON.parse)
        .catchReturn(undefined);
}

/**
 * Creates the .rung folder when it doesn't exist
 *
 * @return {Promise}
 */
function resolveRungFolder() {
    const folder = path.join(os.homedir(), '.rung');
    const createIfNotExists = tryCatch(
        () => fs.lstatSync(folder).isDirectory()
            ? resolve()
            : reject(new Error('~/.rung is not a directory')),
        () => createFolder(folder)
    );

    return createIfNotExists();
}

function getPackage() {
    return readFile('package.json')
        .then(JSON.parse);
}

function cliRead() {
    return getPackage()
        .then(({ name }) => read(name))
        .then(render)
        .tap(console.log.bind(console))
        .catch(() => reject(new Error('Unable to read database')));
}

function cliClear() {
    return getPackage()
        .then(({ name }) => clear(name))
        .catch(() => reject(new Error('Unable to clear database')));
}

export default pipe(prop('option'), cond([
    [equals('read'), cliRead],
    [equals('clear'), cliClear],
    [T, option => reject(new Error(`Unknown option ${option}`))]
]));
