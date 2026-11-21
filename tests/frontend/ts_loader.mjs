import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..', '..');
const srcRoot = path.join(appRoot, 'src');

const CANDIDATE_EXTS = ['.ts', '.tsx', '.js', '.mjs'];

function resolveFileCandidate(basePath) {
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return basePath;
  }
  for (const ext of CANDIDATE_EXTS) {
    const withExt = basePath + ext;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return withExt;
    }
  }
  if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
    for (const ext of CANDIDATE_EXTS) {
      const idx = path.join(basePath, `index${ext}`);
      if (fs.existsSync(idx) && fs.statSync(idx).isFile()) {
        return idx;
      }
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.css')) {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export default {}',
      };
    }

    if (specifier.startsWith('@/')) {
      const target = path.join(srcRoot, specifier.slice(2));
      const resolved = resolveFileCandidate(target);
      if (resolved) {
        return {
          shortCircuit: true,
          url: pathToFileURL(resolved).href,
        };
      }
    }

    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const parentPath = fileURLToPath(context.parentURL);
      const target = path.resolve(path.dirname(parentPath), specifier);
      const resolved = resolveFileCandidate(target);
      if (resolved) {
        return {
          shortCircuit: true,
          url: pathToFileURL(resolved).href,
        };
      }
    }

    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    if (url.startsWith('file://') && !url.includes('/node_modules/')) {
      const filePath = fileURLToPath(url);
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        const source = fs.readFileSync(filePath, 'utf8');
        const result = ts.transpileModule(source, {
          fileName: filePath,
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            isolatedModules: true,
          },
        });
        return {
          shortCircuit: true,
          format: 'module',
          source: result.outputText,
        };
      }
    }
    return nextLoad(url, context);
  },
});
