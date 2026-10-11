// Writes src/lib/editor/fileIconData.ts: the Catppuccin file and folder icons the Editor uses, copied out of
// @iconify-json/catppuccin so the app ships only these. Run with `node scripts/gen-file-icons.mjs` after changing the lists.
import { readFileSync, writeFileSync } from "node:fs";

const set = JSON.parse(readFileSync("node_modules/@iconify-json/catppuccin/icons.json", "utf8"));

const spaced = (s) => Object.fromEntries(s.trim().split(/\s+/).map((pair) => pair.split("=")));

// extension -> icon
const EXT = spaced(`
js=javascript mjs=javascript cjs=javascript jsx=javascript-react ts=typescript mts=typescript cts=typescript tsx=typescript-react
py=python pyc=python-compiled pyi=python rs=rust go=go c=c h=c-header cpp=cpp cc=cpp cxx=cpp hpp=cpp-header hh=cpp-header
java=java kt=kotlin kts=kotlin swift=swift cs=csharp rb=ruby php=php lua=lua sh=bash bash=bash zsh=bash fish=bash ps1=powershell
bat=batch cmd=batch html=html htm=html css=css scss=sass sass=sass less=less vue=vue svelte=svelte astro=astro
json=json jsonc=json json5=json yaml=yaml yml=yaml toml=toml xml=xml sql=database csv=csv tsv=csv lock=lock env=env
md=markdown markdown=markdown mdx=markdown-mdx txt=text log=log rst=text org=org tex=latex typ=typst
png=image jpg=image jpeg=image gif=image webp=image bmp=image ico=favicon avif=image svg=svg pdf=pdf
zip=zip tar=zip gz=zip tgz=zip rar=zip 7z=zip mp3=audio wav=audio ogg=audio flac=audio m4a=audio mp4=video mov=video webm=video mkv=video
ttf=font otf=font woff=font woff2=font doc=ms-word docx=ms-word xls=ms-excel xlsx=ms-excel ppt=ms-powerpoint pptx=ms-powerpoint
dart=dart scala=scala hs=haskell ex=elixir exs=elixir erl=erlang zig=zig r=r jl=julia clj=clojure ml=ocaml nim=nim v=v
graphql=graphql gql=graphql proto=proto tf=terraform nix=nix ipynb=jupyter wasm=web-assembly diff=diff patch=diff
ini=config conf=config cfg=config properties=properties exe=exe key=key pem=certificate crt=certificate sol=solidity glsl=shader
`);

// whole file names (lower case) -> icon
const NAMES = spaced(`
package.json=package-json package-lock.json=npm-lock pnpm-lock.yaml=pnpm-lock yarn.lock=yarn-lock bun.lockb=bun-lock bun.lock=bun-lock
cargo.toml=cargo cargo.lock=cargo-lock dockerfile=docker docker-compose.yml=docker-compose docker-compose.yaml=docker-compose
compose.yml=docker-compose compose.yaml=docker-compose .dockerignore=docker-ignore .gitignore=git .gitattributes=git .gitmodules=git
.gitlab-ci.yml=gitlab makefile=makefile cmakelists.txt=cmake readme=readme readme.md=readme license=license license.md=license
license.txt=license changelog=changelog changelog.md=changelog contributing.md=contributing code_of_conduct.md=code-of-conduct
.editorconfig=editorconfig .babelrc=babel tauri.conf.json=tauri requirements.txt=python-config pyproject.toml=python-config
go.mod=go-mod go.sum=go-mod .npmrc=npm .nvmrc=npm .npmignore=npm-ignore deno.json=deno deno.jsonc=deno justfile=just
robots.txt=robots .env=env .envrc=envrc .eslintignore=eslint-ignore .prettierignore=prettier-ignore .browserslistrc=browserslist
`);

// patterns on the whole file name, tried in order before the extension
const PATTERNS = [
	[/^tsconfig.*\.json$/, "typescript-config"],
	[/\.d\.ts$/, "typescript-def"],
	[/\.(test|spec)\.tsx?$/, "typescript-test"],
	[/\.(test|spec)\.[mc]?jsx?$/, "javascript-test"],
	[/^\.env(\..*)?$/, "env"],
	[/^(\.eslintrc.*|eslint\.config\..*)$/, "eslint"],
	[/^(\.prettierrc.*|prettier\.config\..*)$/, "prettier"],
	[/^vite\.config\..*$/, "vite"],
	[/^vitest\.config\..*$/, "vitest"],
	[/^tailwind\.config\..*$/, "tailwind"],
	[/^webpack\.config\..*$/, "webpack"],
	[/^rollup\.config\..*$/, "rollup"],
	[/^jest\.config\..*$/, "jest"],
	[/^babel\.config\..*$/, "babel"],
	[/^postcss\.config\..*$/, "postcss"],
	[/^readme(\..*)?$/, "readme"],
	[/^license(\..*)?$/, "license"],
	[/^changelog(\..*)?$/, "changelog"],
];

// folder name (lower case) -> folder icon
const FOLDERS = spaced(`
src=folder-src components=folder-components lib=folder-lib libs=folder-lib utils=folder-utils util=folder-utils helpers=folder-utils
hooks=folder-hooks composables=folder-composables pages=folder-views views=folder-views routes=folder-routes api=folder-api
assets=folder-assets public=folder-public static=folder-public images=folder-images img=folder-images icons=folder-images
fonts=folder-fonts styles=folder-styles css=folder-styles scss=folder-sass sass=folder-sass tests=folder-tests test=folder-tests
__tests__=folder-tests spec=folder-tests docs=folder-docs doc=folder-docs config=folder-config configs=folder-config
scripts=folder-scripts dist=folder-dist build=folder-dist out=folder-dist node_modules=folder-node .git=folder-git
.github=folder-github .gitlab=folder-gitlab .vscode=folder-vscode .husky=folder-husky types=folder-types server=folder-server
client=folder-client store=folder-redux redux=folder-redux state=folder-redux middleware=folder-middleware layouts=folder-layouts
templates=folder-templates themes=folder-themes plugins=folder-plugins packages=folder-packages shared=folder-shared
common=folder-shared core=folder-core controllers=folder-controllers mocks=folder-mocks __mocks__=folder-mocks examples=folder-examples
temp=folder-temp tmp=folder-temp docker=folder-docker src-tauri=folder-tauri tauri=folder-tauri locales=folder-locales
i18n=folder-locales workflows=folder-workflows security=folder-security video=folder-video videos=folder-video audio=folder-audio
download=folder-download downloads=folder-download upload=folder-upload uploads=folder-upload include=folder-include
cargo=folder-cargo cloud=folder-cloud database=folder-database db=folder-database debug=folder-debug functions=folder-functions
messages=folder-messages queue=folder-queue private=folder-private content=folder-content constants=folder-constant
app=folder-app admin=folder-admin android=folder-android benchmark=folder-benchmark coverage=folder-coverage linux=folder-linux
macos=folder-macos windows=folder-windows next=folder-next .next=folder-next nuxt=folder-nuxt prisma=folder-prisma
storybook=folder-storybook .storybook=folder-storybook vercel=folder-vercel xcode=folder-xcode graphql=folder-graphql
kubernetes=folder-kubernetes k8s=folder-kubernetes proto=folder-proto animation=folder-animation animations=folder-animation
`);

const used = new Set(["file", "folder", "folder-open", ...Object.values(EXT), ...Object.values(NAMES), ...PATTERNS.map((p) => p[1])]);
for (const base of ["folder", ...Object.values(FOLDERS)]) {
	used.add(base);
	used.add(`${base}-open`);
}
const missing = [...used].filter((n) => !set.icons[n]);
if (missing.length) {
	// An unknown icon falls back to the plain one rather than failing the build
	console.warn("Not in the set, dropped:", missing.join(", "));
}
const keep = (map) => Object.fromEntries(Object.entries(map).filter(([, icon]) => set.icons[icon]));
const bodies = Object.fromEntries([...used].filter((n) => set.icons[n]).sort().map((n) => [n, set.icons[n].body]));

const out = `// Generated by scripts/gen-file-icons.mjs from @iconify-json/catppuccin (MIT). Do not edit by hand.
// Every icon is drawn on a 16 by 16 grid.

export const ICON_BODIES: Record<string, string> = ${JSON.stringify(bodies, null, "\t")};

export const EXTENSION_ICONS: Record<string, string> = ${JSON.stringify(keep(EXT))};

export const FILE_NAME_ICONS: Record<string, string> = ${JSON.stringify(keep(NAMES))};

export const FILE_NAME_PATTERNS: [RegExp, string][] = [
${PATTERNS.filter(([, icon]) => set.icons[icon]).map(([re, icon]) => `\t[${re}, "${icon}"],`).join("\n")}
];

export const FOLDER_ICONS: Record<string, string> = ${JSON.stringify(keep(FOLDERS))};
`;
writeFileSync("src/lib/editor/fileIconData.ts", out);
console.log(`${Object.keys(bodies).length} icons, ${(out.length / 1024).toFixed(0)} KB`);
