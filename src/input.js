import readline from 'readline';
import Promise, { resolve, promisify } from 'bluebird';
import {
    both,
    concat,
    curry,
    has,
    is,
    isNil,
    keys,
    mapObjIndexed,
    pipe,
    propEq,
    toPairs
} from 'ramda';
import { blue, green, red, yellow } from 'colors/safe';
import read from 'read';
import { getTypeName, cast } from './types';

/**
 * Emits a warning to stdout
 *
 * @param {String} message
 * @return {Promise}
 */
export function emitWarning(message) {
    console.log(yellow(` ⚠ Warning: ${message}`));
    return resolve();
}

/**
 * Emits an error to stdout
 *
 * @param {String} message
 * @return {Promise}
 */
export function emitError(message) {
    console.log(red(` ✗ Error: ${message}`));
    return resolve();
}

/**
 * Emits a success message
 *
 * @param {String} message
 * @return {Promise}
 */
export function emitSuccess(message) {
    console.log(green(` ✔ Success: ${message}`));
    return resolve();
}

/**
 * Returns an IO object that promisifies everything that is necessary and exposes
 * a clear API
 *
 * @author Marcelo Haskell Camargo
 * @return {Object}
 */
export function IO() {
    const io = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return {
        read: promisify((text, callback) => {
            io.question(`${text}: `, callback.bind(null, null));
        }),
        close: io.close.bind(io),
        password: promisify((text, callback) => {
            io.close();
            read({ prompt: `${text}: `, silent: true, replace: '*' }, callback);
        })
    };
}

/**
 * Triggers the warnings related to bad coding practices
 *
 * @param {IO} io
 * @param {Object} questions
 */
export function triggerWarnings(io, questions) {
    const getFieldWarnings = pipe(
        mapObjIndexed(both(has('default'), propEq('required', true))),
        toPairs);

    const triggerLanguageWarnings = () => has('language', questions)
        ? emitWarning('don\'t use context.params.language. Prefer context.locale')
        : resolve();

    return getFieldWarnings(questions).reduce((promise, [key, hasWarning]) =>
        promise.then(() => hasWarning
            ? emitWarning(`using both 'required' and 'default' fields is a very bad practice! on (${key})`)
            : resolve()), resolve())
            .then(triggerLanguageWarnings);
}

/**
 * Returns the resolved value, based on required properties and default values
 *
 * @param {String} text
 * @param {Object} type
 * @param {Mixed} def
 * @param {Boolean} required
 */
export function resolveValue(text, type, def, required) {
    if (required && text.trim() === '') {
        return null;
    }

    const nativeValue = cast(text, type);
    const isEmptyString = value => is(String, value) && value.trim() === '';

    return nativeValue === null || isEmptyString(nativeValue) ? def : nativeValue;
}

/**
 * Returns the pure JS values from received questions that will be answered
 *
 * @author Marcelo Haskell Camargo
 * @param {Object} questions
 * @return {Promise} answers for the questions by key
 */
export function ask(questions) {
    const io = IO();
    const recur = curry((remaining, answered, callback) => {
        if (remaining.length > 0) {
            const [head, ...tail] = remaining;
            const { description, type, default: def, required } = questions[head];

            io.read(`${red.bold(getTypeName(type))}> ${blue(description)}`).done(answer => {
                const value = resolveValue(answer, type, def, required);

                const args = isNil(value)
                    ? [remaining, answered, callback]
                    : [tail, concat(answered, [{ [head]: value }]), callback];

                return recur(...args);
            });
        } else {
            io.close();
            return callback(answered);
        }
    });

    return triggerWarnings(io, questions)
        .then(() => new Promise(recur(keys(questions), [])));
}
