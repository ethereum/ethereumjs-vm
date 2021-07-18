import Common, { Chain, Hardfork } from '@ethereumjs/common'
import { getOpcodesForHF } from '../../src/evm/opcodes'

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
const opcodes = getOpcodesForHF(common)

const data =
  '6107608061000e6000396000f30060003560e060020a90048063141961bc1461006e57806319ac74bd146100cf578063278ecde1146100e75780632c0f7b6f146100f8578063a87430ba1461010a578063ac273aa21461011f578063c06f4c1d14610133578063c1cbbca714610159578063e11523431461016a57005b610079600435610183565b8b6000528a60205289600160a060020a031660405288600160a060020a0316606052876080528660a0528560c0528460e05283610100528261012052816101405280600160a060020a0316610160526101806000f35b6100dd6004356024356106e8565b8060005260206000f35b6100f2600435610454565b60006000f35b61010061017c565b8060005260206000f35b6101156004356101da565b8060005260206000f35b61012d600435602435610729565b60006000f35b61015360043560243560443560643560843560a43560c43560e4356101ee565b60006000f35b610164600435610302565b60006000f35b6101756004356105dd565b60006000f35b5b60005481565b5b6000526001602052604060002080549080600101549080600201549080600301549080600401549080600501549080600601549080600701549080600801549080600901549080600c01549080600d015490508c565b5b600052600260205260406000208054905081565b600060006000600060008811801561020557504287115b61020e576102f4565b600080549081600101905593506001600085815260200190815260200160002092508b83819055508a83600101819055503383600201819055508883600301819055508783600501819055508683600401819055508583600701819055508983600c01819055508483600d01819055506002600033600160a060020a03168152602001908152602001600020915081805490816001019055905083826001016000838152602001908152602001600020819055508333600160a060020a03167f882da991e52c8933ce57314c9ba3f934798d912d862790c40d0feeb7025af08a60006000a35b505050505050505050505050565b600060006000600034116103155761044e565b600160008581526020019081526020016000209250428360040154101561033b5761044d565b82600901805490816001019055915082600a0160008381526020019081526020016000209050338181905550348160010181905550806001015483600601818154019150819055508183600b01600033600160a060020a03168152602001908152602001600020819055508333600160a060020a03167fc5e578961e5bd7481ccf1d1bdfbad97b9f1ddfad520f061ca764a57018f3febe6000866006015481526020016000a3600083600d0154600160a060020a031614156103fc5761044c565b82600d0154600160a060020a03166249f068600060008260e060020a02600052600488815260200133600160a060020a03168152602001348152602001600060008660325a03f161044957005b50505b5b5b50505050565b60006000600160008481526020019081526020016000209150816004015442118015610487575081600501548260060154105b8015610497575060008260060154115b6104a0576105d8565b81600a01600083600b01600033600160a060020a03168152602001908152602001600020548152602001908152602001600020905060008160010154116104e6576105d7565b8054600160a060020a0316600082600101546000600060006000848787f161050a57005b505050806001015482600601818154039150819055508233600160a060020a03167fe139691e7435f1fb40ec50ed3729009226be49087fd00e9e5bac276c2a8f40cf6000846001015481526020016000a360008160010181905550600082600d0154600160a060020a03161415610580576105d6565b81600d0154600160a060020a031663b71f3cde600060008260e060020a0260005260048781526020018554600160a060020a0316815260200185600101548152602001600060008660325a03f16105d357005b50505b5b5b505050565b6000600160008381526020019081526020016000209050806005015481600601541015610609576106e4565b8060030154600160a060020a0316600082600601546000600060006000848787f161063057005b5050508133600160a060020a03167f6be92574b1386f424263a096e8b66ff6cc223ab0f9d18702563aa339a372cf986000846006015481526020016000a36000816006018190555060018160080181905550600081600d0154600160a060020a0316141561069d576106e3565b80600d0154600160a060020a031663484ec26c600060008260e060020a02600052600486815260200185600601548152602001600060008660325a03f16106e057005b50505b5b5050565b600060006002600085600160a060020a0316815260200190815260200160002090508060010160008481526020019081526020016000205491505092915050565b6000600060016000858152602001908152602001600020905080600a0160008481526020019081526020016000209150509291505056'

nameOpCodes(Buffer.from(data, 'hex'))

function nameOpCodes(raw) {
  let pushData

  for (let i = 0; i < raw.length; i++) {
    const pc = i
    const curOpCode = opcodes[raw[pc]].name

    // no destinations into the middle of PUSH
    if (curOpCode.slice(0, 4) === 'PUSH') {
      const jumpNum = raw[pc] - 0x5f
      pushData = raw.slice(pc + 1, pc + jumpNum + 1)
      i += jumpNum
    }

    console.log(
      pad(pc, roundLog(raw.length, 10)) + '  ' + curOpCode + ' ' + pushData.toString('hex'),
    )

    pushData = ''
  }
}

function pad(num, size) {
  let s = num + ''
  while (s.length < size) s = '0' + s
  return s
}

function log(num, base) {
  return Math.log(num) / Math.log(base)
}

function roundLog(num, base) {
  return Math.ceil(log(num, base))
}
