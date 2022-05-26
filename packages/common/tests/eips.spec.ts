import tape from 'tape'
import Common, { ChainId, HardforkName } from '../src/'

tape('[Common/EIPs]: Initialization / Chain params', function (t: tape.Test) {
  t.test('Correct initialization', function (st: tape.Test) {
    let eips = [2537, 2929]
    const c = new Common({ chain: ChainId.Mainnet, eips })
    st.equal(c.eips(), eips, 'should initialize with supported EIP')

    eips = [2718, 2929, 2930]
    new Common({ chain: ChainId.Mainnet, eips, hardfork: HardforkName.Istanbul })
    st.pass('Should not throw when initializing with a consistent EIP list')

    eips = [2930]
    const msg =
      'should throw when initializing with an EIP with required EIPs not being activated along'
    const f = () => {
      new Common({ chain: ChainId.Mainnet, eips, hardfork: HardforkName.Istanbul })
    }
    st.throws(f, msg)

    st.end()
  })

  t.test('Initialization errors', function (st: tape.Test) {
    const UNSUPPORTED_EIP = 1000000
    const eips = [UNSUPPORTED_EIP]
    const msg = 'should throw on an unsupported EIP'
    const f = () => {
      new Common({ chain: ChainId.Mainnet, eips })
    }
    st.throws(f, /not supported$/, msg)

    /*
    // Manual test since no test triggering EIP config available
    // TODO: recheck on addition of new EIP configs
    // To run manually change minimumHardfork in EIP2537 config to petersburg
    eips = [ 2537, ]
    msg = 'should throw on not meeting minimum hardfork requirements'
    f = () => {
      new Common({ chain: ChainId.Mainnet, hardfork: HardforkName.Byzantium, eips })
    }
    st.throws(f, /minimumHardfork/, msg)
    */

    st.end()
  })

  t.test('isActivatedEIP()', function (st) {
    let c = new Common({ chain: ChainId.Rinkeby, hardfork: HardforkName.Istanbul })
    st.equal(c.isActivatedEIP(2315), false, 'istanbul, eips: [] -> false (EIP-2315)')
    c = new Common({ chain: ChainId.Rinkeby, hardfork: HardforkName.Istanbul, eips: [2315] })
    st.equal(c.isActivatedEIP(2315), true, 'istanbul, eips: [2315] -> true (EIP-2315)')
    c = new Common({ chain: ChainId.Rinkeby, hardfork: HardforkName.Berlin })
    st.equal(c.isActivatedEIP(2929), true, 'berlin, eips: [] -> true (EIP-2929)')
    st.equal(c.isActivatedEIP(2315), false, 'berlin, eips: [] -> true (EIP-2315)')
    st.equal(c.isActivatedEIP(2537), false, 'berlin, eips: [] -> false (EIP-2537)')

    st.end()
  })
})
