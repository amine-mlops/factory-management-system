/**
 * Regenerates public/mock_data.json (the locked reference payload) from the
 * in-code preset source of truth. Run: `npm run mock:generate`
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPreset } from '../src/lib/presets.ts'

const target = fileURLToPath(new URL('../public/mock_data.json', import.meta.url))
writeFileSync(target, `${JSON.stringify(getPreset('pump_cavitation'), null, 2)}\n`)
console.log(`wrote ${target}`)
