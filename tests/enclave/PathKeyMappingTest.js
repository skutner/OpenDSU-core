require("../../../../psknode/bundles/testsRuntime");
const tir = require("../../../../psknode/tests/util/tir");

const dc = require("double-check");
const assert = dc.assert;
const openDSU = require('../../index');
$$.__registerModule("opendsu", openDSU);
const enclaveAPI = openDSU.loadAPI("enclave");
const keySSISpace = openDSU.loadAPI("keyssi");
const scAPI = openDSU.loadAPI("sc");

const EnclaveHandler = require("../../enclave/impl/WalletDBEnclaveHandler");
const PathKeyMapping = require("../../enclave/impl/PathKeyMapping");
assert.callback('WalletDBEnclave test', (testFinished) => {
    dc.createTestFolder('createDSU', async (err, folder) => {
        const vaultDomainConfig = {
            "anchoring": {
                "type": "FS",
                "option": {}
            }
        }
        await tir.launchConfigurableApiHubTestNodeAsync({domains: [{name: "vault", config: vaultDomainConfig}]});

        const mainEnclave = enclaveAPI.initialiseWalletDBEnclave();
        mainEnclave.on("initialised", async () => {
            await $$.promisify(scAPI.setMainEnclave)(mainEnclave);
            const mainEnclaveKeySSI = await $$.promisify(mainEnclave.getKeySSI)();
            const enclaveHandler = new EnclaveHandler(mainEnclaveKeySSI);
            const pathKeySSIMapping = new PathKeyMapping(enclaveHandler);
            const pathKeySSI = keySSISpace.createPathKeySSI("vault", `0/path`);
            await $$.promisify(pathKeySSIMapping.storePathKeySSI)(pathKeySSI);
            const anchorId = await $$.promisify(pathKeySSI.getAnchorId)();
            const capableOfSigningKeySSI = await $$.promisify(pathKeySSIMapping.getCapableOfSigningKeySSI)(anchorId);
            assert.equal(capableOfSigningKeySSI, pathKeySSI.getIdentifier());
            const newPathKeyMapping = new PathKeyMapping(enclaveHandler);
            const newCapableOfSigningKeySSI = await $$.promisify(newPathKeyMapping.getCapableOfSigningKeySSI)(anchorId);
            assert.equal(newCapableOfSigningKeySSI, capableOfSigningKeySSI);

            testFinished();
        });
    });
}, 1000000);