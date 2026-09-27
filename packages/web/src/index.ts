/**
 * Host entry of the MyWork UI package.
 *
 * The package's value today is its BROWSER half: `exports["./client"]` is a
 * classic script the page module system registers, and the `dsh.client`
 * declaration in `package.json` is what makes the client scan load it
 * (`packages/client/modules/src/index.ts`, `parseDshClient` + `clientExportOf`).
 * The host half exists because a profile row mounts a package, not a subpath:
 * the Loader resolves `exports["."]` and needs a plugin face there.
 * @module @dsh-mywork/web
 */

/** Plugin name: the bare package name the profile row must use. */
export const name = '@dsh-mywork/web'

/**
 * Mount the host half for one composition row.
 *
 * Deliberately empty. This package owns no host service yet, and a placeholder
 * service would be a second source of truth for the board: the board's host
 * face (routes, transport, projection) arrives with the surface steps (`B-*`),
 * and this is the function they extend. A row that mounts this package is
 * therefore valid and silent — which is exactly what F-58 needs from the host
 * side, since the registration this step proves happens in the browser half.
 */
export function apply(): void {}
