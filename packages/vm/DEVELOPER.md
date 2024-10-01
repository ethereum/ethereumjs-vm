# Developer Documentation

## TESTING

### Running Tests

Tests can be found in the `tests` directory. There are test runners for [State tests](http://www.ethdocs.org/en/latest/contracts-and-transactions/ethereum-tests/state_tests/index.html) and [Blockchain tests](http://www.ethdocs.org/en/latest/contracts-and-transactions/ethereum-tests/blockchain_tests/index.html). VM tests are disabled since Frontier gas costs are not supported any more.

Tests are then executed against a snapshot of the official client-independent [Ethereum tests](https://github.com/ethereum/tests) integrated in the monorepo as a submodule in [packages/ethereum-tests](./../ethereum-tests/) pointing towards a specific commit or tag from the `ethereum/tests` `develop` branch.

For a wider picture about how to use tests to implement EIPs you can have a look at this [Reddit post](https://www.reddit.com/r/ethereum/comments/6kc5g3/ethereumjs_team_is_seeking_contributors/)
or the associated YouTube video introduction to [Core Development with Ethereumjs-vm](https://www.youtube.com/watch?v=L0BVDl6HZzk).

#### Running different Test Types

Running the State tests:

`tsx ./test/tester --state`

Running the Blockchain tests:

`tsx ./test/tester --blockchain`

Tests run against source by default. They can be run with the `--dist` flag:

`npm run build:dist && node ./test/tester --state --dist`

See `package.json` for all the scripts in the `test:` namespace, such as `npm run test:state` which would execute the above.

Use `--fork` to pass in the desired hardfork:

`tsx ./test/tester --state --fork='Constantinople'`

or

`npm run test:state -- --fork='Constantinople'`

By default it is set to use the latest hardfork (`FORK_CONFIG` in `tests/tester.js`).

The `--fork` parameter can also be used to activate EIPs. This is done by first entering the hardfork, and then add the EIPs separated with the `+` sign. For instance:

`npm run test:state -- --fork='London+3855'`

Will run the state tests with the London hardfork and with EIP-3855 activated. To activate multiple EIPs:

`npm run test:blockchain -- --fork='London+3855+3860'`

This runs the blockchain tests on the London hardfork with the EIP-3855 and EIP-3860 activated. Note, that only tests which have testdata on this specific configuration will run: most combinations will run 0 tests.

State tests run significantly faster than Blockchain tests, so it is often a good choice to start fixing State tests.

#### Running Specific Tests

Running all the blockchain tests in a file:

`tsx ./test/tester --blockchain --file='randomStatetest303'`

Running tests from a specific directory:

`tsx ./test/tester --blockchain --dir='bcBlockGasLimitTest'`

Running a specific state test case:

`tsx ./test/tester --state --test='stackOverflow'`

Only run test cases with selected `data`, `gas` and/or `value` values (see
[attribute description](http://ethereum-tests.readthedocs.io/en/latest/test_types/state_tests.html) in
test docs), provided by the index of the array element in the test `transaction` section:

`tsx ./test/tester --state --test='CreateCollisionToEmpty' --data=0 --gas=1 --value=0`

Recursively run all tests from a custom directory:

`tsx ./test/tester --state --fork='London' --customTestsPath=../../my_custom_test_folder`

Run a test from a specified source file not under the `tests` directory (only state tests):

`tsx ./test/tester --state --customStateTest='{path_to_file}'`

#### Running tests with a reporter/formatter

`npm run formatTest -t [npm script name OR node command] -with [formatter]` will report test results using a formatter of your choosing.

`npm install -g tap-mocha-reporter`
`npm run formatTest -- -t test:API -with 'tap-mocha-reporter json'`

To pipe the results of tests run with a node command to a formatter:

`npm run formatTest -- -t "./test/tester --blockchain --dir='bcBlockGasLimitTest'" -with 'tap-mocha-reporter json'`

If no reporter or formatter is provided, test results will be reported by `tape` without any additional formatting.

#### Skipping Tests

There are three types of skip lists (`BROKEN`, `PERMANENT` and `SLOW`) which
can be found in `test/tester.js`. By default tests from all skip lists are omitted.

You can change this behaviour with:

`tsx ./test/tester --state --skip=BROKEN,PERMANENT`

to skip only the `BROKEN` and `PERMANENT` tests and include the `SLOW` tests.
There are also the keywords `NONE` or `ALL` for convenience.

It is also possible to only run the tests from the skip lists:

`tsx ./test/tester --state --runSkipped=SLOW`

#### Profiling Tests

Test runs can be profiled using the new EVM/VM profiling functionality by using the `--profile` option for test runs:

`tsx ./test/tester --state --test='CreateCollisionToEmpty' --data=0 --gas=1 --value=0 --profile`

### CI Test Integration

Tests and checks are run in CI using [Github Actions](https://github.com/ethereumjs/ethereumjs-monorepo/actions). The configuration can be found in `.github/workflows`.

#### On-demand testing for VM State and Blockchain

On an ordinary PR, `vm-state-extended` and `vm-blockchain-extended` will be skipped
unless the special label `type: test all hardforks` is applied.
If the label is removed, the extended tests will not run anymore.

### Debugging

#### Local Debugging

For state tests you can use the `--jsontrace` flag to output opcode trace information.

Blockchain tests support `--debug` to verify the postState:

`tsx ./test/tester --blockchain --debug --test='ZeroValue_SELFDESTRUCT_ToOneStorageKey_OOGRevert_d0g0v0_EIP158'`

All/most State tests are replicated as Blockchain tests in a `GeneralStateTests` [sub directory](https://github.com/ethereum/tests/tree/develop/BlockchainTests/GeneralStateTests) in the Ethereum tests repo, so for debugging single test cases the Blockchain test version of the State test can be used.

#### Comparing Stack Traces

Other client implementations often also provide functionality for output trace information.

A convenient way is to use a local `geth` installation (can be the binary installation and doesn't has to be build from source or something) and then use the included `evm` tool like:

```shell
evm --json --nomemory statetest node_modules/ethereumjs-testing/tests/GeneralStateTests/stCreate2/create2collisionCode2.json
```

If you want to have only the output for a specific fork you can go into the referenced json test file and temporarily delete the `post` section for the non-desired fork outputs (or, more safe and also more convenient on triggering later: copy the test files you are interested in to your working directory and then modify without further worrying).

#### Debugging Tools

For comparing `EVM` traces [here](https://gist.github.com/cdetrio/41172f374ae32047a6c9e97fa9d09ad0) are some instructions for setting up `pyethereum` to generate corresponding traces for state tests.

Compare TAP output from blockchain/state tests and produces concise diff of the differences between them (example):

```
curl https://gist.githubusercontent.com/jwasinger/6cef66711b5e0787667ceb3db6bea0dc/raw/0740f03b4ce90d0955d5aba1e0c30ce698c7145a/gistfile1.txt > output-wip-byzantium.txt
curl https://gist.githubusercontent.com/jwasinger/e7004e82426ff0a7137a88d273f11819/raw/66fbd58722747ebe4f7006cee59bbe22461df8eb/gistfile1.txt > output-master.txt
python utils/diffTestOutput.py output-wip-byzantium.txt output-master.txt
```

An extremely rich and powerful toolbox is the [evmlab](https://github.com/holiman/evmlab) from `holiman`, both for debugging and creating new test cases or example data.

## Git Branch Performance Testing

The [`diffTester`](./scripts/diffTester.sh) script can be used to do simple comparative performance testing of changes made targeting the VM. This script allows you to run a single State test a specified number of times on two different branches and reports the average time of the test run for each branch. While not statistically rigorous, it gives you a quick sense of how a specific change (or set of changes) may impact VM performance on a given area that is covered by one specific test. Run this script from `[monorepo-root]/packages/vm` as below:

```sh
./scripts/diffTester.sh -b git-branch-you-want-to-test -t "path/to/my/favorite/state/test.json" -r [the number of times to run the test]
```

and it will produce output like for the `git-branch-you-want-to-test` and then whatever git branch you are currently on:

```sh
TAP version 13
# GeneralStateTests
# file: path/to/my/favorite/state/test.json test: test
ok 1 [ 3.785 secs ] the state roots should match (successful tx run)
ok 2 [ 1.228 secs ] the state roots should match (successful tx run)
ok 3 [ 1.212 secs ] the state roots should match (successful tx run)
ok 4 [ 1.306 secs ] the state roots should match (successful tx run)
ok 5 [ 1.472 secs ] the state roots should match (successful tx run)
# Average test run: 1.801 s
```

Note: this script runs by actually checking out the targeted branch, running the test, and then switching back to your current branch, running the test again, and then restoring any changes you had in the current branch. For best results, you should run this test while you currently have `master` checked out.

## Profiling

[Clinic](https://github.com/nearform/node-clinic) allows profiling the VM in the node environment. It supports various profiling methods, among them is [flame](https://github.com/nearform/node-clinic-flame) which can be used for generating flamegraphs to highlight bottlenecks and hot paths. As an example, to generate a flamegraph for the VM blockchain tests, you can run:

```sh
NODE_OPTIONS="--max-old-space-size=4096" clinic flame -- node ./test/tester.js --blockchain --excludeDir='GeneralStateTests'
```

## Benchmarks

This helps us see how the VM performs when running mainnet blocks.

View the historical benchmark data for the master branch on the [github page](http://ethereumjs.github.io/ethereumjs-monorepo/dev/bench/vm).

We want to use the compiled JS so `tsx` does not show up in the profile. So run:

`npm run build:benchmarks`

Then:

`npm run benchmarks -- mainnetBlocks`

To define the number of samples to be run pass in a number like so: `npm run benchmarks -- mainnetBlocks:10`

To benchmark individual bytecode against empty state:
`node --max-old-space-size=4096 ./benchmarks/run.js benchmarks bytecode:10 -b 60FF60005261FFFF600020`

To benchmark individual bytecode against a state:
`node --max-old-space-size=4096 ./benchmarks/run.js benchmarks bytecode:10 -b 60FF60005261FFFF600020 -p prestate.json`

If you want to get a more detailed look to find bottlenecks we can use [0x](https://github.com/davidmarkclements/0x):

```
npm run profiling -- mainnetBlocks:10
```

and open the link it generates.

For a high-level introduction on flame graphs see e.g. [this](https://blog.codecentric.de/en/2017/09/jvm-fire-using-flame-graphs-analyse-performance/) blog article (the non-Java part).
