import parseGlob from 'parse-glob';
import {
    statSync,
    existsSync,
} from 'fs';
import { PathDescriptor } from './types';
import {
    normalizeAbsolutePath,
    normalizeAlias,
    normalizeSrcPath,
} from './normalizers';
import {
    CollectionType,
    ProjectConfigParser,
} from '@agros/config';
import * as path from 'path';

const projectConfigParser = new ProjectConfigParser();

export const getPathDescriptorWithAlias = (pathname: string, dirname = normalizeSrcPath()): PathDescriptor => {
    /**
     * relative pathname without `baseDir`
     */
    let relativePath: string;
    const alias = projectConfigParser.getConfig('alias') || {};

    for (const aliasKey of Object.keys(alias)) {
        const normalizedAliasPath = normalizeAlias(aliasKey);
        const aliasPathRegExp = new RegExp(normalizedAliasPath, 'gi');
        const execResult = aliasPathRegExp.exec(pathname);

        if (
            !aliasKey ||
            !alias[aliasKey] ||
            !execResult ||
            execResult.length < 2
        ) {
            continue;
        }

        const tailPath = path.join(...execResult.slice(1, execResult.length));
        const aliasValueGlobPattern = parseGlob(alias[aliasKey]);

        relativePath = aliasValueGlobPattern.is.glob
            ? path.join(aliasValueGlobPattern.path.dirname, tailPath)
            : path.join(alias[aliasKey], tailPath);

        break;
    }

    const parsedRelativePath = relativePath || path.relative(
        normalizeSrcPath(),
        normalizeAbsolutePath(pathname, dirname),
    );
    const absolutePath = normalizeAbsolutePath(parsedRelativePath);

    if (!existsSync(absolutePath)) {
        return null;
    }

    const {
        isBlockDevice,
        isCharacterDevice,
        isDirectory,
        isFIFO,
        isFile,
        isSocket,
        isSymbolicLink,
    } = statSync(absolutePath);

    return {
        relativePath: parsedRelativePath,
        aliasPath: relativePath ? pathname : null,
        absolutePath,
        filename: path.basename(absolutePath),
        isBlockDevice,
        isCharacterDevice,
        isDirectory,
        isFIFO,
        isFile,
        isSocket,
        isSymbolicLink,
    };
};

export const getCollectionType = (pathname: string): CollectionType => {
    const collectionMap = projectConfigParser.getConfig('collection');
    for (const collectionType of Object.keys(collectionMap)) {
        for (const filenamePattern of collectionMap[collectionType]) {
            if (new RegExp(`${filenamePattern.replace('*', '(.*)')}$`).exec(pathname).length > 1) {
                return collectionType as CollectionType;
            }
        }
    }
    return null;
};
