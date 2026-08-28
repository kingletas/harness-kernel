import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * The set of non-passing outcomes the last run had, committed so that a check
 * going permanently `unsupported` is a diff somebody has to approve.
 */
export const readSignature = (path: string): string =>
	existsSync(path) ? readFileSync(path, 'utf8').trimEnd() : ''

export const writeSignature = (path: string, signature: string): void => {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, signature === '' ? '' : `${signature}\n`, 'utf8')
}
