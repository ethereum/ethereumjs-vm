import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { getActivePrecompiles } from '@ethereumjs/evm'
import { Address, bufferToHex } from '@ethereumjs/util'
import * as tape from 'tape'

import { VM } from '../../../src/vm'
import { isRunningInKarma } from '../../util'

const precompileAddressStart = 0x0a
const precompileAddressEnd = 0x12

const precompiles: string[] = []

for (let address = precompileAddressStart; address <= precompileAddressEnd; address++) {
  precompiles.push(address.toString(16).padStart(40, '0'))
}

tape('EIP-2537 BLS tests', (t) => {
  t.test('BLS precompiles should not be available if EIP not activated', async (st) => {
    if (isRunningInKarma()) {
      st.skip('BLS does not work in karma')
      return st.end()
    }
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.MuirGlacier })
    const vm = await VM.create({ common: common })

    for (const address of precompiles) {
      const to = new Address(Buffer.from(address, 'hex'))
      const result = await vm.evm.runCall({
        caller: Address.zero(),
        gasLimit: BigInt(0xffffffffff),
        to,
        value: BigInt(0),
        data: Buffer.alloc(0),
      })

      if (result.execResult.executionGasUsed !== BigInt(0)) {
        st.fail('BLS precompiles should not use any gas if EIP not activated')
      }

      if (result.execResult.exceptionError !== null) {
        st.fail('BLS precompiles should not throw if EIP not activated')
      }
    }

    st.pass('BLS precompiles unreachable if EIP not activated')
    st.end()
  })

  t.test('BLS precompiles should throw on empty inputs', async (st) => {
    if (isRunningInKarma()) {
      st.skip('BLS does not work in karma')
      return st.end()
    }
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Byzantium, eips: [2537] })
    const vm = await VM.create({ common: common })

    for (const address of precompiles) {
      const to = new Address(Buffer.from(address, 'hex'))
      const result = await vm.evm.runCall({
        caller: Address.zero(),
        gasLimit: BigInt(0xffffffffff),
        to,
        value: BigInt(0),
        data: Buffer.alloc(0),
      })

      if (result.execResult.executionGasUsed !== BigInt(0xffffffffff)) {
        st.fail('BLS precompiles should use all gas on empty inputs')
      }

      if (result.execResult.exceptionError == null) {
        st.fail('BLS precompiles should throw on empty inputs')
      }
    }

    st.pass('BLS precompiles throw correctly on empty inputs')
    st.end()
  })

  /*
    The following tests validate that the various precompiles associated with EIP2537 produce expected results against test vectors
    pulled from this collection of test data provided by Matter Labs here -
    https://github.com/matter-labs/eip1962/tree/master/src/test/test_vectors/eip2537

    In each test, the precompile should take the testVector and produce the testVectorResult
  */
  t.test('BLS12-G2MultiExp', async (st) => {
    if (isRunningInKarma()) {
      st.skip('BLS does not work in karma')
      return st.end()
    }
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Berlin, eips: [2537] })
    const vm = await VM.create({ common: common })
    const BLS12G2MultiExp = getActivePrecompiles(common).get(
      '000000000000000000000000000000000000000f'
    )!

    const testVector =
      '00000000000000000000000000000000039b10ccd664da6f273ea134bb55ee48f09ba585a7e2bb95b5aec610631ac49810d5d616f67ba0147e6d1be476ea220e0000000000000000000000000000000000fbcdff4e48e07d1f73ec42fe7eb026f5c30407cfd2f22bbbfe5b2a09e8a7bb4884178cb6afd1c95f80e646929d30040000000000000000000000000000000001ed3b0e71acb0adbf44643374edbf4405af87cfc0507db7e8978889c6c3afbe9754d1182e98ac3060d64994d31ef576000000000000000000000000000000001681a2bf65b83be5a2ca50430949b6e2a099977482e9405b593f34d2ed877a3f0d1bddc37d0cec4d59d7df74b2b8f2dfb3c940fe79b6966489b527955de7599194a9ac69a6ff58b8d99e7b1084f0464e0000000000000000000000000000000018c0ada6351b70661f053365deae56910798bd2ace6e2bf6ba4192d1a229967f6af6ca1c9a8a11ebc0a232344ee0f6d6000000000000000000000000000000000cc70a587f4652039d8117b6103858adcd9728f6aebe230578389a62da0042b7623b1c0436734f463cfdd187d20903240000000000000000000000000000000009f50bd7beedb23328818f9ffdafdb6da6a4dd80c5a9048ab8b154df3cad938ccede829f1156f769d9e149791e8e0cd900000000000000000000000000000000079ba50d2511631b20b6d6f3841e616e9d11b68ec3368cd60129d9d4787ab56c4e9145a38927e51c9cd6271d493d93884d0e25bf3f6fc9f4da25d21fdc71773f1947b7a8a775b8177f7eca990b05b71d0000000000000000000000000000000003632695b09dbf86163909d2bb25995b36ad1d137cf252860fd4bb6c95749e19eb0c1383e9d2f93f2791cb0cf6c8ed9d000000000000000000000000000000001688a855609b0bbff4452d146396558ff18777f329fd4f76a96859dabfc6a6f6977c2496280dbe3b1f8923990c1d6407000000000000000000000000000000000c8567fee05d05af279adc67179468a29d7520b067dbb348ee315a99504f70a206538b81a457cce855f4851ad48b7e80000000000000000000000000000000001238dcdfa80ea46e1500026ea5feadb421de4409f4992ffbf5ae59fa67fd82f38452642a50261b849e74b4a33eed70cc973f40c12c92b703d7b7848ef8b4466d40823aad3943a312b57432b91ff68be1000000000000000000000000000000000149704960cccf9d5ea414c73871e896b1d4cf0a946b0db72f5f2c5df98d2ec4f3adbbc14c78047961bc9620cb6cfb5900000000000000000000000000000000140c5d25e534fb1bfdc19ba4cecaabe619f6e0cd3d60b0f17dafd7bcd27b286d4f4477d00c5e1af22ee1a0c67fbf177c00000000000000000000000000000000029a1727041590b8459890de736df15c00d80ab007c3aee692ddcdf75790c9806d198e9f4502bec2f0a623491c3f877d0000000000000000000000000000000008a94c98baa9409151030d4fae2bd4a64c6f11ea3c99b9661fdaed226b9a7c2a7d609be34afda5d18b8911b6e015bf494c51f97bcdda93904ae26991b471e9ea942e2b5b8ed26055da11c58bc7b5002a000000000000000000000000000000001156d478661337478ab0cbc877a99d9e4d9824a2b3f605d41404d6b557b3ffabbf42635b0bbcb854cf9ed8b8637561a8000000000000000000000000000000001147ed317d5642e699787a7b47e6795c9a8943a34a694007e44f8654ba96390cf19f010dcf695e22c21874022c6ce291000000000000000000000000000000000c6dccdf920fd5e7fae284115511952633744c6ad94120d9cae6acda8a7c23c48bd912cba6c38de5159587e1e6cad519000000000000000000000000000000001944227d462bc2e5dcc6f6db0f83dad411ba8895262836f975b2b91e06fd0e2138862162acc04e9e65050b34ccbd1a4e8964d5867927bc3e35a0b4c457482373969bff5edff8a781d65573e07fd87b890000000000000000000000000000000019c31e3ab8cc9c920aa8f56371f133b6cb8d7b0b74b23c0c7201aca79e5ae69dc01f1f74d2492dcb081895b17d106b4e000000000000000000000000000000001789b0d371bd63077ccde3dbbebf3531368feb775bced187fb31cc6821481664600978e323ff21085b8c08e0f21daf72000000000000000000000000000000000009eacfe8f4a2a9bae6573424d07f42bd6af8a9d55f71476a7e3c7a4b2b898550c1e72ec13afd4eff22421a03af1d31000000000000000000000000000000000410bd4ea74dcfa33f2976aa1b571c67cbb596ab10f76a8aaf4548f1097e55b3373bff02683f806cb84e1e0e877819e2787c38b944eadbd03fd3187f450571740f6cd00e5b2e560165846eb800e5c94400000000000000000000000000000000147f09986691f2e57073378e8bfd58804241eed7934f6adfe6d0a6bac4da0b738495778a303e52113e1c80e698476d50000000000000000000000000000000000762348b84c92a8ca6de319cf1f8f11db296a71b90fe13e1e4bcd25903829c00a5d2ad4b1c8d98c37eaad7e042ab023d0000000000000000000000000000000011d1d94530d4a2daf0e902a5c3382cd135938557f94b04bccea5e16ea089c5e020e13524c854a316662bd68784fe31f300000000000000000000000000000000070828522bec75b6a492fd9bca7b54dac6fbbf4f0bc3179d312bb65c647439e3868e4d5b21af5a64c93aeee8a9b7e46eaaee7ae2a237e8e53560c79e7baa9adf9c00a0ea4d6f514e7a6832eb15cef1e1000000000000000000000000000000000690a0869204c8dced5ba0ce13554b2703a3f18afb8fa8fa1c457d79c58fdc25471ae85bafad52e506fc1917fc3becff0000000000000000000000000000000010f7dbb16f8571ede1cec79e3f9ea03ae6468d7285984713f19607f5cab902b9a6b7cbcfd900be5c2e407cc093ea0e6700000000000000000000000000000000151caf87968433cb1f85fc1854c57049be22c26497a86bfbd66a2b3af121d894dba8004a17c6ff96a5843c2719fa32d10000000000000000000000000000000011f0270f2b039409f70392879bcc2c67c836c100cf9883d3dc48d7adbcd52037d270539e863a951acd47ecaa1ca4db12dac6ed3ef45c1d7d3028f0f89e5458797996d3294b95bebe049b76c7d0db317c0000000000000000000000000000000017fae043c8fd4c520a90d4a6bd95f5b0484acc279b899e7b1d8f7f7831cc6ba37cd5965c4dc674768f5805842d433af30000000000000000000000000000000008ddd7b41b8fa4d29fb931830f29b46f4015ec202d51cb969d7c832aafc0995c875cd45eff4a083e2d5ecb5ad185b64f0000000000000000000000000000000015d384ab7e52420b83a69827257cb52b00f0199ed2240a142812b46cf67e92b99942ac59fb9f9efd7dd822f5a36c799f00000000000000000000000000000000074b3a16a9cc4be9da0ac8e2e7003d9c1ec89244d2c33441b31af76716cce439f805843a9a44701203231efdca551d5bbb30985756c3ca075114c92f231575d6befafe4084517f1166a47376867bd108000000000000000000000000000000000e25365988664e8b6ade2e5a40da49c11ff1e084cc0f8dca51f0d0578555d39e3617c8cadb2abc2633b28c5895ab0a9e00000000000000000000000000000000169f5fd768152169c403475dee475576fd2cc3788179453b0039ff3cb1b7a5a0fff8f82d03f56e65cad579218486c3b600000000000000000000000000000000087ccd7f92032febc1f75c7115111ede4acbb2e429cbccf3959524d0b79c449d431ff65485e1aecb442b53fec80ecb4000000000000000000000000000000000135d63f264360003b2eb28f126c6621a40088c6eb15acc4aea89d6068e9d5a47f842aa4b4300f5cda5cc5831edb81596fb730105809f64ea522983d6bbb62f7e2e8cbf702685e9be10e2ef71f818767200000000000000000000000000000000159da74f15e4c614b418997f81a1b8a3d9eb8dd80d94b5bad664bff271bb0f2d8f3c4ceb947dc6300d5003a2f7d7a829000000000000000000000000000000000cdd4d1d4666f385dd54052cf5c1966328403251bebb29f0d553a9a96b5ade350c8493270e9b5282d8a06f9fa8d7b1d900000000000000000000000000000000189f8d3c94fdaa72cc67a7f93d35f91e22206ff9e97eed9601196c28d45b69c802ae92bcbf582754717b0355e08d37c000000000000000000000000000000000054b0a282610f108fc7f6736b8c22c8778d082bf4b0d0abca5a228198eba6a868910dd5c5c440036968e977955054196b6a9408625b0ca8fcbfb21d34eec2d8e24e9a30d2d3b32d7a37d110b13afbfea000000000000000000000000000000000f29b0d2b6e3466668e1328048e8dbc782c1111ab8cbe718c85d58ded992d97ca8ba20b9d048feb6ed0aa1b4139d02d3000000000000000000000000000000000d1f0dae940b99fbfc6e4a58480cac8c4e6b2fe33ce6f39c7ac1671046ce94d9e16cba2bb62c6749ef73d45bea21501a000000000000000000000000000000001902ccece1c0c763fd06934a76d1f2f056563ae6d8592bafd589cfebd6f057726fd908614ccd6518a21c66ecc2f78b660000000000000000000000000000000017f6b113f8872c3187d20b0c765d73b850b54244a719cf461fb318796c0b8f310b5490959f9d9187f99c8ed3e25e42a93b77283d0a7bb9e17a27e66851792fdd605cc0a339028b8985390fd024374c76000000000000000000000000000000000576b8cf1e69efdc277465c344cadf7f8cceffacbeca83821f3ff81717308b97f4ac046f1926e7c2eb42677d7afc257c000000000000000000000000000000000cc1524531e96f3c00e4250dd351aedb5a4c3184aff52ec8c13d470068f5967f3674fe173ee239933e67501a9decc6680000000000000000000000000000000001610cfcaea414c241b44cf6f3cc319dcb51d6b8de29c8a6869ff7c1ebb7b747d881e922b42e8fab96bde7cf23e8e4cd0000000000000000000000000000000017d4444dc8b6893b681cf10dac8169054f9d2f61d3dd5fd785ae7afa49d18ebbde9ce8dde5641adc6b38173173459836dd994eae929aee7428fdda2e44f8cb12b10b91c83b22abc8bbb561310b62257c000000000000000000000000000000000ca8f961f86ee6c46fc88fbbf721ba760186f13cd4cce743f19dc60a89fd985cb3feee34dcc4656735a326f515a729e400000000000000000000000000000000174baf466b809b1155d524050f7ee58c7c5cf728c674e0ce549f5551047a4479ca15bdf69b403b03fa74eb1b26bbff6c0000000000000000000000000000000000e8c8b587c171b1b292779abfef57202ed29e7fe94ade9634ec5a2b3b4692a4f3c15468e3f6418b144674be70780d5b000000000000000000000000000000001865e99cf97d88bdf56dae32314eb32295c39a1e755cd7d1478bea8520b9ff21c39b683b92ae15568420c390c42b123b7010b134989c8368c7f831f9dd9f9a890e2c1435681107414f2e8637153bbf6a0000000000000000000000000000000017eccd446f10018219a1bd111b8786cf9febd49f9e7e754e82dd155ead59b819f0f20e42f4635d5044ec5d550d847623000000000000000000000000000000000403969d2b8f914ff2ea3bf902782642e2c6157bd2a343acf60ff9125b48b558d990a74c6d4d6398e7a3cc2a16037346000000000000000000000000000000000bd45f61f142bd78619fb520715320eb5e6ebafa8b078ce796ba62fe1a549d5fb9df57e92d8d2795988eb6ae18cf9d9300000000000000000000000000000000097db1314e064b8e670ec286958f17065bce644cf240ab1b1b220504560d36a0b43fc18453ff3a2bb315e219965f5bd394c68bc8d91ac8c489ee87dbfc4b94c93c8bbd5fc04c27db8b02303f3a65905400000000000000000000000000000000018244ab39a716e252cbfb986c7958b371e29ea9190010d1f5e1cfdb6ce4822d4055c37cd411fc9a0c46d728f2c13ecf0000000000000000000000000000000001985d3c667c8d68c9adb92bdc7a8af959c17146544997d97116120a0f55366bd7ad7ffa28d93ee51222ff9222779675000000000000000000000000000000000c70fd4e3c8f2a451f83fb6c046431b38251b7bae44cf8d36df69a03e2d3ce6137498523fcf0bcf29b5d69e8f265e24d00000000000000000000000000000000047b9163a218f7654a72e0d7c651a2cf7fd95e9784a59e0bf119d081de6c0465d374a55fbc1eff9828c9fd29abf4c4bdb3682accc3939283b870357cf83683350baf73aa0d3d68bda82a0f6ae7e51746'
    const testVectorResult =
      '0x00000000000000000000000000000000083ad744b34f6393bc983222b004657494232c5d9fbc978d76e2377a28a34c4528da5d91cbc0977dc953397a6d21eca20000000000000000000000000000000015aec6526e151cf5b8403353517dfb9a162087a698b71f32b266d3c5c936a83975d5567c25b3a5994042ec1379c8e526000000000000000000000000000000000e3647185d1a20efad19f975729908840dc33909a583600f7915025f906aef9c022fd34e618170b11178aaa824ae36b300000000000000000000000000000000159576d1d53f6cd12c39d651697e11798321f17cd287118d7ebeabf68281bc03109ee103ee8ef2ef93c71dd1dcbaf1e0'

    const result = await BLS12G2MultiExp({
      data: Buffer.from(testVector, 'hex'),
      gasLimit: BigInt(5000000),
      _common: common,
      _EVM: <any>vm.evm,
    })

    st.deepEqual(
      testVectorResult,
      bufferToHex(result.returnValue),
      'return value should match testVectorResult'
    )
    st.end()
  })
})
