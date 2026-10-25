// Where the bytes of case files live. The database records each file (`case_files`) with a
// storage key; a FileStore keeps the bytes under that key. For now the only store is a directory
// on local disk; an object store can implement the same interface later.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export interface FileStore {
	/** Stores the bytes and returns the key to read them back with. */
	put(bytes: Uint8Array): Promise<string>;
	/** The bytes stored under `key`, or undefined when there are none. */
	get(key: string): Promise<Uint8Array | undefined>;
	/** Removes what is stored under `key`, if anything. */
	delete(key: string): Promise<void>;
}

const KEY = /^[0-9a-f]{2}\/[0-9a-f-]{36}$/;

/**
 * Keeps files in a directory on local disk, one file per key, spread over subdirectories by the
 * first two characters of a random id. Keys never come from user input, and anything that does
 * not look like a key is refused, so a key cannot reach outside the directory.
 */
export function localFileStore(directory: string): FileStore {
	const root = resolve(directory);
	const pathOf = (key: string) => {
		if (!KEY.test(key)) throw new Error(`"${key}" is not a file store key`);
		const path = resolve(join(root, key));
		if (!path.startsWith(root + sep)) throw new Error(`"${key}" is outside the file store`);
		return path;
	};
	return {
		async put(bytes) {
			const id = randomUUID();
			const key = `${id.slice(0, 2)}/${id}`;
			await mkdir(join(root, key.slice(0, 2)), { recursive: true });
			await writeFile(pathOf(key), bytes);
			return key;
		},
		async get(key) {
			try {
				return new Uint8Array(await readFile(pathOf(key)));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
				throw error;
			}
		},
		async delete(key) {
			await rm(pathOf(key), { force: true });
		}
	};
}

/** Keeps files in memory, for tests and for seeding a database whose files are not needed. */
export function memoryFileStore(): FileStore {
	const files = new Map<string, Uint8Array>();
	return {
		async put(bytes) {
			const id = randomUUID();
			const key = `${id.slice(0, 2)}/${id}`;
			files.set(key, bytes.slice());
			return key;
		},
		async get(key) {
			return files.get(key)?.slice();
		},
		async delete(key) {
			files.delete(key);
		}
	};
}

/** The directory `CASEBOOK_FILES_DIR` names, or `.casebook/files` under the working directory. */
export function filesDirectory(env: NodeJS.ProcessEnv = process.env): string {
	return resolve(env.CASEBOOK_FILES_DIR ?? join('.casebook', 'files'));
}
