import path from 'path';
import Zip from 'jszip';
import Promise, { all, promisifyAll, resolve } from 'bluebird';
import {
    complement,
    concat,
    contains,
    curry,
    drop,
    equals,
    endsWith,
    filter,
    head,
    identity,
    ifElse,
    is,
    join,
    lensProp,
    map,
    mapObjIndexed,
    merge,
    over,
    pipe,
    prop,
    propEq,
    replace,
    sort,
    startsWith,
    subtract,
    takeWhile,
    test,
    tryCatch,
    unary,
    union,
    without
} from 'ramda';
import deepmerge from 'deepmerge';
import { emitSuccess, emitWarning } from './input';
import { getProperties } from './vm';
import { compileModulesFromSource, ensureNoImports, inspect } from './module';

const fs = promisifyAll(require('fs'));

const defaultFileOptions = { date: new Date(1149562800000) };
const requiredFiles = ['package.json', 'index.js'];

const localeByFile = pipe(
    drop(8),
    takeWhile(complement(equals('.'))),
    join('')
);

/**
 * Converts a list of locale files to pairs containing locale string and content
 *
 * @param {String[]} localeFiles
 * @return {Promise}
 */
function localesToPairs(localeFiles) {
    return all(localeFiles.map(localeFile => fs.readFileAsync(localeFile, 'utf-8')
        .then(JSON.parse)
        .then(json => [localeByFile(localeFile), json])));
}

/**
 * Projects locale for each translatable subfield
 *
 * @param {String} locale
 * @param {Object} config
 * @return {Object}
 */
const project = curry((locale, config) => ({
    title: { [locale]: config.title },
    description: { [locale]: config.description },
    preview: { [locale]: config.preview },
    params: mapObjIndexed(param => merge(param,
        { description: { [locale]: param.description } }), config.params)
}));

/**
 * Lazily runs the extension using all possible listed locales and extracts
 * the meta-data.
 *
 * @param {String} source
 * @param {[(String, *)]} locales
 * @return {Promise}
 */
const runInAllLocales = curry((source, locales) =>
    compileModulesFromSource(source).then(modules =>
        all([['default', {}], ...locales].map(([locale, strings]) =>
            getProperties({ name: `precompile-${locale}`, source }, strings, modules)
                .then(project(locale))))
                .then(ifElse(propEq('length', 1), head, unary(deepmerge.all)))));

/**
 * Creates a meta file where the information about precompilation is stored
 *
 * @param {Object} locales
 * @return {Promise}
 */
function createMetaFile(locales) {
    return fs.writeFileAsync('.meta', JSON.stringify(locales));
}

/**
 * Precompiles linked files, generating a .meta file with all the meta data
 *
 * @param {Object<String, String[]>} { code, files }
 * @return {Promise}
 */
function precompile({ code, files }) {
    return resolve(files)
        .then(filter(test(/^locales(\/|\\)[a-z]{2,3}(_[A-Z]{2})?\.json$/)))
        .then(localesToPairs)
        .then(runInAllLocales(code))
        .then(createMetaFile)
        .thenReturn(['.meta', ...files]);
}

/**
 * Ensures there are missing no files in order to a allow a basic compilation
 * and filter the used modules. It also warns about possible improvements in the
 * extensions
 *
 * @param {String[]} files
 * @return {Promise}
 */
function filterFiles(files) {
    const clearModule = replace(/^\.\//, '');
    const missingFiles = without(files, requiredFiles);
    const hasIcon = contains('icon.png', files);
    const resources = hasIcon ? ['icon.png'] : [];

    if (missingFiles.length > 0) {
        throw new Error(`missing ${missingFiles.join(', ')} from the project`);
    }

    if (!hasIcon) {
        emitWarning('compiling extension without providing an icon.png file');
    }

    return fs.readFileAsync('index.js', 'utf-8')
        .then(inspect)
        .then(over(lensProp('modules'), filter(startsWith('./'))))
        .then(({ code, modules }) => ({
            code, files: union(modules.map(clearModule), concat(resources, requiredFiles)) }));
}

/**
 * Returns all the files in a directory if it exists. Otherwise, return an
 * empty array as fallback (everything inside a promise)
 *
 * @param {String} directory
 * @return {String[]}
 */
function listFiles(directory) {
    return fs.lstatAsync(directory)
        .then(lstat => lstat.isDirectory() ? fs.readdirAsync(directory) : [])
        .catchReturn([]);
}

/**
 * Links autocomplete files
 *
 * @return {Promise}
 */
function linkAutoComplete() {
    return listFiles('autocomplete')
        .then(pipe(filter(endsWith('.js')), map(file => path.join('autocomplete', file))))
        .tap(files => all(files.map(file => fs.readFileAsync(file)
            .then(ensureNoImports(file)))));
}

/**
 * Links locale files
 *
 * @return {Promise}
 */
function linkLocales() {
    return listFiles('locales')
        .then(pipe(
            filter(test(/^[a-z]{2}(_[A-Z]{2,3})?\.json$/)),
            map(file => path.join('locales', file))))
        .filter(location => fs.readFileAsync(location)
            .then(pipe(JSON.parse, is(Object)))
            .catchReturn(false))
        .catchReturn([]);
}

/**
 * Links the files to precompilation, including locales and autocomplete
 * scripts. For autocomplete files, ensuring it is a valid script without
 * requires. For locales, filtering true locale files and appending the full
 * qualified name for current files.
 *
 * @param {Object<String, String[]>} { code, files }
 * @return {Promise}
 */
function linkFiles({ code, files }) {
    return all([linkLocales(), linkAutoComplete()])
        .spread(union)
        .then(pipe(union(files), sort(subtract), files => ({ code, files })));
}

/**
 * Opens package.json and extrats its contents. Returns a promise containing
 * the file list to be zipped and the package.json content parsed
 *
 * @param {String} dir
 * @return {Promise}
 */
function getProjectName(dir) {
    return fs.readFileAsync(path.join(dir, 'package.json'))
        .then(pipe(JSON.parse, prop('name')))
        .catchThrow(new Error('Failed to parse package.json from the project'));
}

/**
 * Generates a zip package using a node buffer containing the necessary files
 *
 * @param {String} dir
 * @param {String[]} files
 * @param {String} name
 */
const createZip = curry((dir, files) => {
    const zip = new Zip();
    files.forEach(filename => addToZip(zip, dir, filename));
    return zip;
});

/**
 * Taking account the -o parameter can be used to specify the output directory,
 * let's deal with it
 *
 * @param {String} customPath
 * @param {String} filename
 * @return {String}
 */
function resolveOutputTarget(customPath, filename) {
    const realPath = path.resolve('.', customPath);

    const getPath = tryCatch(realPath => fs.lstatSync(realPath).isDirectory()
        ? path.join(realPath, filename)
        : realPath
    , identity);

    return getPath(realPath);
}

/**
 * Saves the zip file from buffer to the filesystem
 *
 * @param {String} dir
 * @param {Zip} zip
 * @param {String} name
 */
const saveZip = curry((dir, zip, name) => {
    const target = resolveOutputTarget(dir, `${name}.rung`);

    return new Promise((resolve, reject) => {
        zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
            .pipe(fs.createWriteStream(target))
            .on('error', reject)
            .on('finish', () => resolve(target));
    });
});

/**
 * Appends a file or folder to the zip buffer
 *
 * @param {Zip} zip
 * @param {String} dir
 * @param {String} filename
 */
function addToZip(zip, dir, filename) {
    const filePath = path.join(dir, filename);
    const lstat = fs.lstatSync(filePath);

    if (lstat.isFile()) {
        return zip.file(filename, fs.readFileSync(filePath), defaultFileOptions);
    }

    if (lstat.isDirectory()) {
        return map(file => addToZip(zip.folder(filename), filePath, file),
            fs.readdirSync(filePath));
    }

    throw new Error(`Invalid file type for ${filePath}`);
}

/**
 * Precompiles an extension and generates a .rung package
 *
 * @param {Object} args
 */
export default function build(args) {
    const dir = path.resolve('.', args._[1] || '');

    return fs.readdirAsync(dir)
        .then(filterFiles)
        .then(linkFiles)
        .then(precompile)
        .then(createZip(dir))
        .then(zip => all([zip, getProjectName(dir)]))
        .spread(saveZip(args.output || '.'))
        .tap(() => emitSuccess('Rung extension compilation'));
}
