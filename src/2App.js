import React from "react";
import "react-notifications/lib/notifications.css";
import Web3 from "web3";
import { Component } from "react";
import { Biconomy } from "@biconomy/mexa";
import WalletConnectProvider from "@walletconnect/web3-provider";
const { config } = require("./config");
let provider = new WalletConnectProvider({
  infuraId: config.data.infura,
  network_id: config.data.chainId
})
// BEGIN: EIP-712 Data
const domainType = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" }
];
const metaTransactionType = [ 
  { name: "nonce", type: "uint256" },
  { name: "from", type: "address" },
  { name: "functionSignature", type: "bytes" }
];
let proxyDomainData = {
  name: "DaiProxyLight",
  version: "1",
  chainId: config.data.chainId,
  verifyingContract: config.data.proxyAddress
};
let daiDomainData = {
  name: "Dai Stablecoin",
  version: "1",
  chainId: config.data.chainId,
  verifyingContract: config.data.tokenAddress
};
const Permit = [ 
  { name: 'holder', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  { name: 'allowed', type: 'bool' }
];
// END: EIP-712 Data


let web3, biconomyObj, contract;

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      metamask: false,     //if metamask = true, app is loading metamask instead of wallet connect
      amount: '',
      rcp: '',
      web3: 'undefined',
      tokenContract: 'undefined',     // dai contract instance
      proxyContract: 'undefined',     // proxy contract instance
      account: 'undefined',
      balance: 'undefined',
      mtxAllowed: false,
    };
  }

  // auto connect when app starts
  componentDidMount = () => {
    this.connect();
  }

  // connect metamask or wallet connect (throws error, if metamask is used and not yet connected to website)
  // load contract instances
  // stores everything in state
  // loads dai balance of user and dai mtx allowance
  connect = async () => {
    if(!this.state.metamask) await provider.enable();
    console.log("provider.enable()")
    if(!this.state.metamask) biconomyObj = new Biconomy(provider, { apiKey: config.data.apiKey, debug: true });
    if(this.state.metamask) biconomyObj = new Biconomy(window["ethereum"], { apiKey: config.data.apiKey, debug: true });
    web3 = new Web3(biconomyObj);

    biconomyObj.onEvent(biconomyObj.READY, async () => {
      // Initialize your dapp here like getting user accounts etc
      this.setState({ biconomy: biconomyObj });

      this.setState({ web3: web3 });

    if(this.state.metamask) await window.ethereum.enable();
    }).onEvent(biconomyObj.ERROR, (error, message) => {
      // Handle error while initializing mexa
      console.log(error)
    });

    let accounts = await web3.eth.getAccounts();
    this.setState({ account: accounts[0] })
    this.setState({ tokenContract: await new web3.eth.Contract(config.data.tokenAbi, config.data.tokenAddress) });
    this.setState({ proxyContract: await new web3.eth.Contract(config.data.proxyAbi, config.data.proxyAddress) });
    console.log("logged in as: " + this.state.account)
    await this.loadBalance();
    await this.loadAllowance();  
  }

  // load user dai balance
  // (rounds on 2 decimal places)
  loadBalance = async () => {
    var balance = await this.state.tokenContract.methods.balanceOf(this.state.account).call()
    this.setState({
      balance: Math.floor(Web3.utils.fromWei(balance, 'ether') * 10000) / 10000
    })
    return;
  }

  // load boolean if dai mtx are allowed or not
  loadAllowance = async () => {
    var allowance = await this.state.tokenContract.methods.allowance(this.state.account, config.data.proxyAddress).call()
    this.setState({
      mtxAllowed: (allowance>0)
    })
    return;
  }

  // called to allow or deny dai mtx (permit)
  // calls internally everthing to sign the transaction
  // execute the mtx
  allowMeta = async () => {
    let permit = await this.signTransferPermit(!this.state.mtxAllowed);
    let tx = await this.state.tokenContract.methods.permit(this.state.account, config.data.proxyAddress, permit.nonce, permit.expiry, permit.allowed, permit.v, permit.r, permit.s).send({from: this.state.account})
    console.log("tx: "+tx);
    this.loadAllowance();
  }

  // method to transfer dai
  // calls internally all methods to sign and send the message
  sendTransaction = async () => {
    let transfer = await this.signTransferExec();
    let tx = await this.state.proxyContract.methods.executeMetaTransaction(transfer.from, transfer.functionSignature, transfer.r, transfer.s, transfer.v).send({from: this.state.account})
    console.log(tx);
  }

  // save recipient address in state
  onChangeRcp = (e) => {
    e.preventDefault();
    this.setState({ rcp: e.target.value });
  }

  // stores amount to send in state
  onChangeAmount = (e) => {
    e.preventDefault();
    this.setState({ amount: this.state.web3.utils.toWei(e.target.value, 'ether') });
  }


  //////////////////////////////
  // Begin EIP-712 Sign Methods
  //////////////////////////////

  // assembles and returns dai permit mtx data
  signTransferPermit = async (allowed) => {
    const messageData = await this.createPermitMessageData(allowed);
    const sig = await this.signData(this.state.web3, this.state.account, messageData.typedData);
    console.log("permit messageData: "+messageData);
    console.log("sig: ");
    console.log(sig);
    return Object.assign({}, sig, messageData.message);
  };

  // assembles and returns proxy contract transfer data
  signTransferExec = async () => {
    const messageData = await this.createExecuteMTXMessageData();
    const sig = await this.signData(this.state.web3, this.state.account, messageData.typedData);
    console.log("exec messageData: "+messageData);
    console.log("sig: ");
    console.log(sig);
    return Object.assign({}, sig, messageData.message);
  };

  // creates mtx json of daiproxylight transfer method
  createExecuteMTXMessageData = async () => {
    let nonce = await this.state.proxyContract.methods.getNonce(this.state.account).call();
    console.log("method: "+this.state.methodName)
    let sig = this.state.proxyContract.methods
        .transfer(this.state.rcp, this.state.amount)
        .encodeABI();
        console.log("transfer");

    const message = {
      nonce: nonce,
      from: this.state.account,
      functionSignature: sig
    }
    console.log("proxy message:");
    console.log(message)

    const typedData = JSON.stringify({
      types: {
        EIP712Domain: domainType,
        MetaTransaction: metaTransactionType
      },
      primaryType: "MetaTransaction",
      domain: proxyDomainData,
      message: message
    });

    console.log("typedData:");
    console.log(typedData)

    return {
      typedData,
      message,
    };
  }
  // creates mtx json of dai permit method
  createPermitMessageData = async (allowed) => {
    let nonce = await this.state.tokenContract.methods.nonces(this.state.account).call();
    let expiry = Date.now() + 9999;

    const message = {
      holder: this.state.account,
      spender: config.data.proxyAddress,
      nonce: parseInt(nonce),
      expiry: expiry,
      allowed: allowed
    }

    console.log("permit message:");
    console.log(message)

    const typedData = JSON.stringify({
      types: {
        EIP712Domain: domainType,
        Permit: Permit
      },
      primaryType: "Permit",
      domain: daiDomainData,
      message: message
    });

    console.log("typedData:");
    console.log(typedData)

    return {
      typedData,
      message,
    };
  }

  // signs message
  signData = async (web3, fromAddress, typeData) => {
    return new Promise(function (resolve, reject) {
      web3.currentProvider.sendAsync(
        {
          id: 1,
          method: "eth_signTypedData_v4",
          params: [fromAddress, typeData],
          from: fromAddress,
        },
        function (err, result) {
          if (err) {
            reject(err); //TODO
          } else {
            const r = result.result.slice(0, 66);
            const s = "0x" + result.result.slice(66, 130);
            const v = Number("0x" + result.result.slice(130, 132));
            console.log("r: "+r);
            console.log("s: "+s);
            console.log("v: "+v);
            
            resolve({
              v,
              r,
              s,
            });
          }
        }
      );
    });
  };

  //////////////////////////////
  //  END EIP-712 Sign Methods
  //////////////////////////////


  render() {
    return (
      <div class="app">
        User: {this.state.account} <br />
        Balance: {this.state.balance} DAI <br />
        mtx allowed: {this.state.mtxAllowed.toString()} 
              {!this.state.mtxAllowed && <button type="submit" value="Submit" onClick={this.allowMeta}>allow</button>}
              {this.state.mtxAllowed && <button type="submit" value="Submit" onClick={this.allowMeta}>deny</button>}
<hr /> 
        <label>
          Recipient Address: <br />
          <input type="text" name="recipient" onChange={this.onChangeRcp} /><br />
            Amount:<br />
          <input type="number" name="amount" onChange={this.onChangeAmount} /><br />
          <button type="submit" value="Submit" onClick={this.sendTransaction}>send</button><br />
        </label>
        <hr />
        Recipient Address: {this.state.rcp} <br />
        Amount: {(this.state.web3 !== 'undefined') && this.state.web3.utils.fromWei(this.state.amount, 'ether')}
        <hr />      
      </div>
    );
  }
}

export default App;