import fs from 'fs';
import os from 'os';
import { all, promisify } from 'bluebird';
import {
    curry,
    identity,
    mapObjIndexed,
    mergeAll,
    pipe,
    prop,
    values
} from 'ramda';
import { Spinner } from 'cli-spinner';
import { green } from 'colors/safe';
import Table from 'cli-table';
import { runAndGetAlerts, getProperties } from './vm';
import { ask } from './input';
import { compileES6 } from './compiler';
import { read } from './db';
import { getLocale, getLocaleStrings } from './i18n';
import { compileModulesFromSource } from './module';

const user = { name: os.userInfo().username };
const percentOf = curry((value, percent) => value / 100 * percent);

export const readFile = promisify(fs.readFile);

function tableView(data) {
    const size = percentOf(process.stdout.columns);
    const colWidths = [10, 20, 35, 26].map(pipe(size, Math.round));
    const valuesFrom = pipe(mapObjIndexed(({ title, content, comment }, key) =>
        [key, title, content || '', comment || '']), values);

    const table = new Table({
        head: ['Key', 'Title', 'Content', 'Comment'],
        colWidths
    });

    table.push(...valuesFrom(data.alerts));
    return table.toString();
}

export function compileSources() {
    return readFile('index.js', 'utf-8')
        .then(index => all([compileES6(index), compileModulesFromSource(index)]));
}

export default function run(args) {
    const spinner = new Spinner(green('%s running extension...'));
    spinner.setSpinnerString(8);

    return readFile('package.json', 'utf-8')
        .then(JSON.parse)
        .then(({ name }) => all([name, read(name), getLocaleStrings(), getLocale()]))
        .spread((name, db, strings, locale) => compileSources()
            .spread((source, modules) => getProperties({ name, source }, strings, modules)
                .then(prop('params'))
                .then(ask)
                .then(mergeAll)
                .tap(() => spinner.start())
                .then(params => runAndGetAlerts({ name, source },
                    { params, db, locale, user }, strings, modules))))
        .tap(() => spinner.stop(true))
        .tap(pipe(args.raw ? identity : tableView, console.log));
}
