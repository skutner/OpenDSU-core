/**
 * @module dt
 */

const {_getByName} = require('./commands');
const {_getSharedEnclave, _getKeySSISpace} = require('./commands/utils');

/**
 * Automates the Dossier Building process
 * Call via
 * <pre>
 *     builder.buildDossier(config, commands, callback)
 * </pre>
 * where the config is as follows (this config is generated by the buildDossier script in octopus given the proper commands):
 * <pre>
 *     {
 *          "seed": "./seed",
 *          "domain": "default",
 *     }
 * </pre>
 *
 * For a Simple SSApp (with only mounting of cardinal/themes and creation of code folder) the commands would be like:
 * <pre>
 *     delete /
 *     addfolder code
 *     mount ../cardinal/seed /cardinal
 *     mount ../themes/'*'/seed /themes/'*'
 * </pre>
 * @param {Archive} [sourceDSU] if provided will perform all OPERATIONS from the sourceDSU as source and not the fs
 * @param {VarStore} [varStore]
 */
const DossierBuilder = function (sourceDSU, varStore) {

    const _varStore = varStore || new (require('./commands/VarStore'))();

    let createDossier = function (conf, commands, callback) {
        console.log("creating a new dossier...")
        _getSharedEnclave((err, sharedEnclave) => {
            if (err) {
                return callback(err);
            }
            sharedEnclave.createDSU(_getKeySSISpace().createTemplateSeedSSI(conf.domain), (err, bar) => {
                if (err)
                    return callback(err);
                updateDossier(bar, conf, commands, callback);
            });
        })
    };

    /**
     * Writes to a file on the filesystem
     * @param filePath
     * @param data
     * @param callback
     */
    const writeFile = function (filePath, data, callback) {
        new (_getByName('createfile'))(_varStore).execute([filePath, data], (err) => err
            ? callback(err)
            : callback(undefined, data));
    }

    /**
     * Reads a file from the filesystem
     * @param filePath
     * @param callback
     */
    const readFile = function (filePath, callback) {
        new (_getByName('readfile'))(_varStore).execute(filePath, callback);
    }

    /**
     * Stores the keySSI to the SEED file when no sourceDSU is provided
     * @param {string} seed_path the path to store in
     * @param {string} keySSI
     * @param {function(err, KeySSI)} callback
     */
    let storeKeySSI = function (seed_path, keySSI, callback) {
        writeFile(seed_path, keySSI, callback);
    };

    /**
     * Runs an operation
     * @param {Archive} bar
     * @param {string|string[]} command
     * @param {string[]} next the remaining commands to be executed
     * @param {function(err, Archive)} callback
     */
    let runCommand = function (bar, command, next, callback) {
        let args = command.split(/\s+/);
        const cmdName = args.shift();
        const cmd = _getByName(cmdName);
        return cmd
            ? new (cmd)(_varStore, this.source).execute(args, bar, next, callback)
            : callback(`Command not recognized: ${cmdName}`);
    };

    /**
     * Retrieves the KeysSSi after save (when applicable)
     * @param {Archive} bar
     * @param {object} cfg is no sourceDSU is provided must contain a seed field
     * @param {function(err, KeySSI)} callback
     */
    let saveDSU = function (bar, cfg, callback) {
        bar.getKeySSIAsString((err, barKeySSI) => {
            if (err)
                return callback(err);
            if (sourceDSU || cfg.skipFsWrite)
                return callback(undefined, barKeySSI);
            storeKeySSI(cfg.seed, barKeySSI, callback);
        });
    };

    /**
     * Run a sequence of {@link Command}s on the DSU
     * @param {Archive} bar
     * @param {object} cfg
     * @param {string[]} commands
     * @param {function(err, KeySSI)} callback
     */
    let updateDossier = function (bar, cfg, commands, callback) {
        if (commands.length === 0) {
            return bar.commitBatch((err) => {
                if (err) {
                    return callback(err);
                }

                saveDSU(bar, cfg, callback);
            })
        }

        if (!bar.batchInProgress()) {
            try {
                bar.beginBatch();
            } catch (e) {
                return callback(e);
            }
        }

        let cmd = commands.shift();
        runCommand(bar, cmd, commands, (err, updated_bar) => {
            if (err) {
                return callback(err);
            }
            updateDossier(updated_bar, cfg, commands, callback);
        });
    };

    /**
     * Builds s DSU according to it's building instructions
     * @param {object|Archive} configOrDSU: can be a config file form octopus or the destination DSU when cloning.
     *
     *
     * Example of config file:
     * <pre>
     *     {
     *         seed: path to SEED file in fs
     *     }
     * </pre>
     * @param {string[]|object[]} [commands]
     * @param {function(err, KeySSI)} callback
     */
    this.buildDossier = function (configOrDSU, commands, callback) {
        if (typeof commands === 'function') {
            callback = commands;
            commands = [];
        }

        let builder = function (keySSI) {
            try {
                keySSI = _getKeySSISpace().parse(keySSI);
            } catch (err) {
                console.log("Invalid keySSI");
                return createDossier(configOrDSU, commands, callback);
            }

            if (keySSI.getDLDomain() && keySSI.getDLDomain() !== configOrDSU.domain) {
                console.log("Domain change detected.");
                return createDossier(configOrDSU, commands, callback);
            }

            _getSharedEnclave((err, sharedEnclave) => {
                if (err) {
                    return callback(err);
                }
                sharedEnclave.loadDSU(keySSI, (err, bar) => {
                    configOrDSU.skipFsWrite = true;
                    if (err) {
                        console.log("DSU not available. Creating a new DSU for", keySSI.getIdentifier());

                        return sharedEnclave.createDSU(keySSI, {useSSIAsIdentifier: true}, (err, bar) => {
                            if (err)
                                return callback(err);
                            updateDossier(bar, configOrDSU, commands, callback);
                        });
                    }
                    console.log("Dossier updating...");
                    updateDossier(bar, configOrDSU, commands, callback);
                });
            });
        }

        require("./index").initialiseBuildWallet(err => {
            if (err) {
                return callback(err);
            }
            if (configOrDSU.constructor && configOrDSU.constructor.name === 'Archive')
                return updateDossier(configOrDSU, {skipFsWrite: true}, commands, callback);

            readFile(configOrDSU.seed, (err, content) => {
                if (err || content.length === 0)
                    return createDossier(configOrDSU, commands, callback);
                builder(content.toString());
            });
        });
    };
};

module.exports = DossierBuilder;
