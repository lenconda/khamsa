import { DI_METADATA_MODULE_SYMBOL } from '../constants';
import {
    ModuleDecoratorOptions,
    ModuleMetadata,
} from '../types';

export function Module(options: ModuleDecoratorOptions = {}): ClassDecorator {
    return (target) => {
        const {
            imports = [],
            providers = [],
            routes = [],
            components = [],
            exports: exportedProviders = [],
        } = options;

        Reflect.defineMetadata(
            DI_METADATA_MODULE_SYMBOL,
            {
                imports: new Set(imports),
                providers: new Set(providers),
                routes: new Set(routes),
                components: new Set(components),
                exports: new Set(exportedProviders),
            } as ModuleMetadata,
            target,
        );
    };
}