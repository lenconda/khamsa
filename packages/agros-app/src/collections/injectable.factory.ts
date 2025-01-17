import {
    addImportedEntityToModule,
    addImportedInjectableToInjectable,
    applyAddUpdates,
} from '@agros/tools/lib/update-utils';
import {
    AbstractGeneratorFactory,
    AbstractUpdaterFactory,
    CollectionFactoryResult,
    UpdateBaseOptions,
} from '@agros/tools/lib/collection';
import {
    normalizeCLIPath,
    normalizeEntityFileName,
} from '@agros/tools/lib/normalizers';
import _ from 'lodash';
import * as fs from 'fs';
import { CollectionType } from '@agros/tools';
import { updateCorrespondingTargetModule } from './utils';

interface InjectableCollectionGenerateOptions {
    name: string;
    moduleName?: string;
    skipExport?: boolean;
}

export class InjectableCollectionGenerateFactory extends AbstractGeneratorFactory implements AbstractGeneratorFactory {
    public constructor(
        protected readonly collectionType: CollectionType,
        protected readonly templateFilePath: string,
        protected readonly fallbackSchema: string,
    ) {
        super();
    }

    public async generate({
        name,
        moduleName,
        skipExport,
    }: InjectableCollectionGenerateOptions) {
        if (!name) {
            throw new Error('Expect `name` to be of type `string`');
        }

        const result: CollectionFactoryResult = {
            create: [],
            update: [],
        };
        const entityName = _.kebabCase(name);
        const entityModuleName = moduleName ? _.kebabCase(moduleName) : entityName;
        const filename = normalizeEntityFileName(this.collectionType, entityName, this.fallbackSchema);
        const targetPath = this.modulesPath(`${entityModuleName}/${filename}`);

        await this.writeTemplateFile(
            this.templateFilePath,
            targetPath,
            {
                name: _.startCase(entityName.toLowerCase()).replace(/\s+/g, ''),
            },
        );

        result.create.push(targetPath);
        this.updateEntities();

        const moduleEntityDescriptor = this.entities.find((entity) => {
            return entity.collectionType === 'module' && entity.moduleName === entityModuleName;
        });

        if (moduleEntityDescriptor) {
            const updates = await addImportedEntityToModule(
                this.getEntityDescriptor(targetPath),
                moduleEntityDescriptor,
                {
                    skipExport,
                },
            );
            await this.writeFile(
                moduleEntityDescriptor.absolutePath,
                applyAddUpdates(updates, fs.readFileSync(moduleEntityDescriptor.absolutePath).toString()),
            );
            result.update.push(moduleEntityDescriptor.absolutePath);
        }

        return result;
    }
}

interface InjectableCollectionUpdateOptions extends UpdateBaseOptions {
    accessibility?: 'private' | 'protected' | 'public';
    skipReadonly?: boolean;
}

export class InjectableCollectionUpdateFactory extends AbstractUpdaterFactory implements AbstractUpdaterFactory {
    public constructor(protected readonly collectionType: CollectionType) {
        super();
    }

    public async add({
        source,
        target,
        accessibility,
        skipReadonly,
    }: InjectableCollectionUpdateOptions) {
        const result: CollectionFactoryResult = {
            create: [],
            update: [],
        };

        const sourceDescriptor = normalizeCLIPath(source, this.entities);
        const targetDescriptor = normalizeCLIPath(target, this.entities, this.collectionType);

        if (!sourceDescriptor) {
            throw new Error(`Cannot find source entity with identifier: ${source}`);
        }

        if (!targetDescriptor) {
            throw new Error(`Cannot find target entity with identifier: ${target}`);
        }

        const updates = await addImportedInjectableToInjectable(sourceDescriptor, targetDescriptor, {
            skipReadonly,
            accessibility,
        });

        if (updates.length > 0) {
            this.writeFile(
                targetDescriptor.absolutePath,
                applyAddUpdates(updates, fs.readFileSync(targetDescriptor.absolutePath).toString()),
            );
            result.update.push(targetDescriptor.absolutePath);
        }

        const [
            sourceModuleUpdates,
            targetModuleUpdates,
        ] = await updateCorrespondingTargetModule(sourceDescriptor, targetDescriptor);

        if (sourceModuleUpdates.length > 0) {
            const absolutePath = sourceDescriptor.modules[0]?.absolutePath;
            this.writeFile(
                absolutePath,
                applyAddUpdates(sourceModuleUpdates, fs.readFileSync(absolutePath).toString()),
            );
            result.update.push(source);
        }

        if (targetModuleUpdates.length > 0) {
            const absolutePath = targetDescriptor.modules[0]?.absolutePath;
            this.writeFile(
                absolutePath,
                applyAddUpdates(targetModuleUpdates, fs.readFileSync(absolutePath).toString()),
            );
            result.update.push(absolutePath);
        }

        return result;
    }
}
