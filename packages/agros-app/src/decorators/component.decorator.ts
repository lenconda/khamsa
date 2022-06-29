import {
    DI_DEPS_SYMBOL,
    DI_METADATA_COMPONENT_SYMBOL,
} from '../constants';
import { ComponentDecoratorOptions } from '../types';

export function Component(options: ComponentDecoratorOptions = {}): ClassDecorator {
    const {
        declarations = [],
        ...metadataValue
    } = options;
    return (target) => {
        Reflect.defineMetadata(
            DI_METADATA_COMPONENT_SYMBOL,
            metadataValue,
            target,
        );
        Reflect.defineMetadata(DI_DEPS_SYMBOL, declarations, target);
    };
}