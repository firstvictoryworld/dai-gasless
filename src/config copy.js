let config = {};
config.data = {
    infura: "<infura api key>", 
    tokenName: "DAI",
    apiKey: "<biconomy api key>", 
    chainId: "<chain id>",
    tokenAddress: "<dai address>",
    tokenAbi: [{..dai abi..}],
    proxyAddress: "<DaiProxyLight address>",
    proxyAbi: [{..daiproxylight abi..}]
}


module.exports = { config }
