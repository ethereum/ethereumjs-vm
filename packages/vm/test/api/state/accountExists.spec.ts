import { Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { Account, Address, hexToBytes, toBytes } from '@ethereumjs/util'
import { assert, describe, it } from 'vitest'

import { createVM } from '../../../src/index.js'

import type { MerkleStateManager } from '@ethereumjs/statemanager'

describe('correctly apply new account gas fee on pre-Spurious Dragon hardforks', () => {
  it('should work', async () => {
    // This transaction https://etherscan.io/tx/0x26ea8719eeca5737f8ca872bca1ac53cea9bf6e11462dd83317c2e66a4e43d7b produced an error
    // in our VM where we were not applying the new account gas fee (25k) for account creation in hardforks before Spurious Dragon
    // This test verifies that issue is now resolved

    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x1747de68ae74afa4e00f8ef79b9c875a339cda70')) // caller address
    const contractAddress = new Address(hexToBytes('0x02E815899482f27C899fB266319dE7cc97F72E87')) // contract address
    // setup the vm
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Homestead })
    const vm = await createVM({ common })
    const code =
      '0x606060405236156101065760e060020a600035046305fefda7811461013d57806306fdde031461016357806318160ddd146101c057806323b872dd146101c95780632e1a7d4d146101fb578063313ce5671461021e5780633177029f1461022a57806347f1d8d7146102d25780634b750334146102db57806370a08231146102e45780638620410b146102fc5780638da5cb5b1461030557806395d89b4114610317578063a6f2ae3a14610372578063a9059cbb146103a2578063b414d4b6146103d1578063c91d956c146103ec578063dc3080f21461040f578063dd62ed3e14610434578063e4849b3214610459578063e724529c1461048f578063f2fde38b146104b5575b6104d860055434111561013b5760055433600160a060020a031660009081526008602052604090208054349290920490910190555b565b6104d8600435602435600054600160a060020a0390811633919091161461084157610002565b60408051600180546020600282841615610100026000190190921691909104601f81018290048202840182019094528383526104da93908301828280156105db5780601f106105b0576101008083540402835291602001916105db565b61054860065481565b610548600435602435604435600160a060020a038316600090815260086020526040812054829010156106f657610002565b6104d8600435600054600160a060020a0390811633919091161461091957610002565b61055a60035460ff1681565b610548600435602435600160a060020a033381166000818152600a60209081526040808320878616808552925280832086905580517f4889ca880000000000000000000000000000000000000000000000000000000081526004810194909452602484018690523090941660448401529251909285929091634889ca88916064808201928792909190829003018183876161da5a03f115610002575060019695505050505050565b61054860075481565b61054860045481565b61054860043560086020526000908152604090205481565b61054860055481565b610571600054600160a060020a031681565b6040805160028054602060018216156101000260001901909116829004601f81018290048202840182019094528383526104da93908301828280156105db5780601f106105b0576101008083540402835291602001916105db565b60055430600160a060020a03166000908152600860205260409020546104d8913404908190101561084c57610002565b6104d8600435602435600160a060020a033316600090815260086020526040902054819010156105f157610002565b61054860043560096020526000908152604090205460ff1681565b6104d8600435600054600160a060020a039081163391909116146105e357610002565b600b602090815260043560009081526040808220909252602435815220546105489081565b600a602090815260043560009081526040808220909252602435815220546105489081565b6104d86004355b806008600050600033600160a060020a031681526020019081526020016000206000505410156108a657610002565b6104d8600435602435600054600160a060020a039081163391909116146107e157610002565b6104d8600435600054600160a060020a0390811633919091161461058e57610002565b005b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600f02600301f150905090810190601f16801561053a5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b60408051918252519081900360200190f35b6040805160ff929092168252519081900360200190f35b60408051600160a060020a03929092168252519081900360200190f35b6000805473ffffffffffffffffffffffffffffffffffffffff19168217905550565b820191906000526020600020905b8154815290600101906020018083116105be57829003601f168201915b505050505081565b66038d7ea4c6800002600755565b600160a060020a038216600090815260086020526040902054818101101561061857610002565b600160a060020a03331660009081526009602052604090205460ff161561063e57610002565b600160a060020a0333811660008181526008602090815260408083208054879003905593861680835291849020805486019055835185815293519193600080516020610940833981519152929081900390910190a3600754600160a060020a0383163110156106c4576007546004546106c491600160a060020a03851631900304610460565b604051600454600754600160a060020a038516926000928431909203919091049082818181858883f150505050505050565b600160a060020a038316600090815260086020526040902054808301101561071d57610002565b600160a060020a038481166000818152600a602090815260408083203390951680845294825280832054938352600b825280832094835293905291909120548301111561076957610002565b600160a060020a03848116600081815260086020908152604080832080548890039055878516808452818420805489019055848452600b835281842033909616845294825291829020805487019055815186815291516000805160206109408339815191529281900390910190a35060019392505050565b600160a060020a038216600081815260096020908152604091829020805460ff1916851790558151928352820183905280517f48335238b4855f35377ed80f164e8c6f3c366e54ac00b96a6402d4a9814a03a59281900390910190a15050565b600491909155600555565b600160a060020a03338116600081815260086020908152604080832080548701905530909416808352918490208054869003905583518581529351929391926000805160206109408339815191529281900390910190a350565b30600160a060020a039081166000908152600860205260408082208054850190553390921680825282822080548590039055915160045484029082818181858883f15084815260405130600160a060020a031694935060008051602061094083398151915292509081900360200190a350565b60008054604051600160a060020a03919091169190839082818181858883f150505050505056ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

    const existingAddress = caller
    await vm.stateManager.putAccount(existingAddress, new Account())
    const existingAccount = await vm.stateManager.getAccount(existingAddress)
    existingAccount!.balance = BigInt(1)
    await vm.stateManager.putAccount(existingAddress, existingAccount!)
    await vm.stateManager.putCode(contractAddress, hexToBytes(code)) // setup the contract code
    await vm.stateManager.putStorage(
      contractAddress,
      hexToBytes('0xd08f588b94e47566eea77acec87441cecca23f61aea9ed8eb086c062d3837605'),
      hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000001'),
    )
    // setup the call arguments
    const runCallArgs = {
      caller, // call address
      gasLimit: BigInt(174146 - 22872), // tx gas limit minus the tx fee (21000) and data fee (1872) to represent correct gas costs
      data: hexToBytes(
        '0xa9059cbb000000000000000000000000f48a1bdc65d9ccb4b569ffd4bffff415b90783d60000000000000000000000000000000000000000000000000000000000000001',
      ),
      to: contractAddress, // call to the contract address
      value: BigInt(0),
    }

    const result = await vm.evm.runCall(runCallArgs)
    assert.equal(
      result.execResult.executionGasUsed,
      BigInt(53552),
      'vm correctly applies new account gas price',
    )
  })
})

describe('do not apply new account gas fee for empty account in DB on pre-Spurious Dragon hardforks', () => {
  it('should work', async () => {
    // setup the accounts for this test
    const caller = new Address(hexToBytes('0x1747de68ae74afa4e00f8ef79b9c875a339cda70')) // caller address
    const contractAddress = new Address(hexToBytes('0x02E815899482f27C899fB266319dE7cc97F72E87')) // contract address
    // setup the vm
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Homestead })
    const vm = await createVM({ common })
    const code =
      '0x606060405236156101065760e060020a600035046305fefda7811461013d57806306fdde031461016357806318160ddd146101c057806323b872dd146101c95780632e1a7d4d146101fb578063313ce5671461021e5780633177029f1461022a57806347f1d8d7146102d25780634b750334146102db57806370a08231146102e45780638620410b146102fc5780638da5cb5b1461030557806395d89b4114610317578063a6f2ae3a14610372578063a9059cbb146103a2578063b414d4b6146103d1578063c91d956c146103ec578063dc3080f21461040f578063dd62ed3e14610434578063e4849b3214610459578063e724529c1461048f578063f2fde38b146104b5575b6104d860055434111561013b5760055433600160a060020a031660009081526008602052604090208054349290920490910190555b565b6104d8600435602435600054600160a060020a0390811633919091161461084157610002565b60408051600180546020600282841615610100026000190190921691909104601f81018290048202840182019094528383526104da93908301828280156105db5780601f106105b0576101008083540402835291602001916105db565b61054860065481565b610548600435602435604435600160a060020a038316600090815260086020526040812054829010156106f657610002565b6104d8600435600054600160a060020a0390811633919091161461091957610002565b61055a60035460ff1681565b610548600435602435600160a060020a033381166000818152600a60209081526040808320878616808552925280832086905580517f4889ca880000000000000000000000000000000000000000000000000000000081526004810194909452602484018690523090941660448401529251909285929091634889ca88916064808201928792909190829003018183876161da5a03f115610002575060019695505050505050565b61054860075481565b61054860045481565b61054860043560086020526000908152604090205481565b61054860055481565b610571600054600160a060020a031681565b6040805160028054602060018216156101000260001901909116829004601f81018290048202840182019094528383526104da93908301828280156105db5780601f106105b0576101008083540402835291602001916105db565b60055430600160a060020a03166000908152600860205260409020546104d8913404908190101561084c57610002565b6104d8600435602435600160a060020a033316600090815260086020526040902054819010156105f157610002565b61054860043560096020526000908152604090205460ff1681565b6104d8600435600054600160a060020a039081163391909116146105e357610002565b600b602090815260043560009081526040808220909252602435815220546105489081565b600a602090815260043560009081526040808220909252602435815220546105489081565b6104d86004355b806008600050600033600160a060020a031681526020019081526020016000206000505410156108a657610002565b6104d8600435602435600054600160a060020a039081163391909116146107e157610002565b6104d8600435600054600160a060020a0390811633919091161461058e57610002565b005b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600f02600301f150905090810190601f16801561053a5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b60408051918252519081900360200190f35b6040805160ff929092168252519081900360200190f35b60408051600160a060020a03929092168252519081900360200190f35b6000805473ffffffffffffffffffffffffffffffffffffffff19168217905550565b820191906000526020600020905b8154815290600101906020018083116105be57829003601f168201915b505050505081565b66038d7ea4c6800002600755565b600160a060020a038216600090815260086020526040902054818101101561061857610002565b600160a060020a03331660009081526009602052604090205460ff161561063e57610002565b600160a060020a0333811660008181526008602090815260408083208054879003905593861680835291849020805486019055835185815293519193600080516020610940833981519152929081900390910190a3600754600160a060020a0383163110156106c4576007546004546106c491600160a060020a03851631900304610460565b604051600454600754600160a060020a038516926000928431909203919091049082818181858883f150505050505050565b600160a060020a038316600090815260086020526040902054808301101561071d57610002565b600160a060020a038481166000818152600a602090815260408083203390951680845294825280832054938352600b825280832094835293905291909120548301111561076957610002565b600160a060020a03848116600081815260086020908152604080832080548890039055878516808452818420805489019055848452600b835281842033909616845294825291829020805487019055815186815291516000805160206109408339815191529281900390910190a35060019392505050565b600160a060020a038216600081815260096020908152604091829020805460ff1916851790558151928352820183905280517f48335238b4855f35377ed80f164e8c6f3c366e54ac00b96a6402d4a9814a03a59281900390910190a15050565b600491909155600555565b600160a060020a03338116600081815260086020908152604080832080548701905530909416808352918490208054869003905583518581529351929391926000805160206109408339815191529281900390910190a350565b30600160a060020a039081166000908152600860205260408082208054850190553390921680825282822080548590039055915160045484029082818181858883f15084815260405130600160a060020a031694935060008051602061094083398151915292509081900360200190a350565b60008054604051600160a060020a03919091169190839082818181858883f150505050505056ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const existingAddress = caller
    await vm.stateManager.putAccount(existingAddress, new Account())
    const existingAccount = await vm.stateManager.getAccount(existingAddress)
    existingAccount!.balance = BigInt(1)
    await vm.stateManager.putAccount(existingAddress, existingAccount!)
    // add empty account to DB
    const emptyAddress = new Address(hexToBytes('0xf48a1bdc65d9ccb4b569ffd4bffff415b90783d6'))
    await vm.stateManager.putAccount(emptyAddress, new Account())
    const emptyAccount = (await vm.stateManager.getAccount(emptyAddress)) as Account
    await (vm.stateManager as MerkleStateManager)['_trie'].put(
      toBytes(emptyAddress),
      emptyAccount.serialize(),
    )
    await vm.stateManager.putCode(contractAddress, hexToBytes(code)) // setup the contract code
    await vm.stateManager.putStorage(
      contractAddress,
      hexToBytes('0xd08f588b94e47566eea77acec87441cecca23f61aea9ed8eb086c062d3837605'),
      hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000001'),
    )
    // setup the call arguments
    const runCallArgs = {
      caller, // call address
      gasLimit: BigInt(174146 - 22872), // tx gas limit minus the tx fee (21000) and data fee (1872) to represent correct gas costs
      data: hexToBytes(
        '0xa9059cbb000000000000000000000000f48a1bdc65d9ccb4b569ffd4bffff415b90783d60000000000000000000000000000000000000000000000000000000000000001',
      ),
      to: contractAddress, // call to the contract address
      value: BigInt(0),
    }

    const result = await vm.evm.runCall(runCallArgs)
    assert.equal(
      result.execResult.executionGasUsed,
      BigInt(28552),
      'new account price not applied as empty account exists',
    )
  })
})
