import fs from 'fs';
import { promisify } from 'bluebird';
import { mergeAll } from 'ramda';
import { runAndGetAlerts, runAndGetParameters } from './vm';
import { ask } from './input';

const readFile = promisify(fs.readFile);

function readSourceFile({ main }) {
    const index = main || 'index.js';
    return readFile(index, 'utf-8');
}

export default function run() {
    return readFile('package.json', 'utf-8')
        .then(JSON.parse)
        .then(readSourceFile)
        .then(source => runAndGetParameters({ name: 'get-parameters', source })
            .then(ask)
            .then(mergeAll)
            .then(params =>
                runAndGetAlerts({ name: 'get-alerts', source }, { params })))
        .tap(console.log.bind(console));
}
