import { createSuite } from './suite'
import { LevelDB } from './engines/level.js'
import { MapDB } from '@ethereumjs/util'

createSuite(new MapDB())
createSuite(new LevelDB())
