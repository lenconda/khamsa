import {
    ServiceCollectionGenerateFactory,
    ServiceCollectionUpdateFactory,
} from './service/service.factory';
import {
    ModuleCollectionGenerateFactory,
    ModuleCollectionUpdateFactory,
} from './module/module.factory';
import {
    ComponentCollectionGenerateFactory,
    ComponentCollectionUpdateFactory,
} from './component/component.factory';
import { ApplicationCollectionGenerateFactory } from './application/application.factory';

export default {
    generate: {
        application: ApplicationCollectionGenerateFactory,
        service: ServiceCollectionGenerateFactory,
        module: ModuleCollectionGenerateFactory,
        component: ComponentCollectionGenerateFactory,
    },
    update: {
        service: ServiceCollectionUpdateFactory,
        module: ModuleCollectionUpdateFactory,
        component: ComponentCollectionUpdateFactory,
    },
};
