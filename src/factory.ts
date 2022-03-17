import 'reflect-metadata';
import {
    AbstractComponent,
    ModuleInstance,
} from './classes';
import {
    DI_DEPS_SYMBOL,
    DI_IMPORTS_SYMBOL,
    DI_PROVIDERS_SYMBOL,
    DI_VIEWS_SYMBOL,
} from './constants';
import {
    AsyncModule,
    RouteConfig,
    RouteConfigItem,
    Type,
    ViewItem,
    ViewMetadata,
} from './types';
import isPromise from 'is-promise';

export class Factory {
    private moduleInstances: Map<any, any> = new Map();
    private routeViews: Set<ViewItem> = new Set();
    private nestedRoute: RouteConfigItem[] = [];

    public async create<T = any>(module: Type<T>): Promise<RouteConfig> {
        await this.createModule(module);
        return this.createNestedRoute();
    }

    private async createModule(moduleOrPromise: Type | AsyncModule) {
        const module = await this.getAsyncExport(moduleOrPromise);

        const imports: Set<Type> = Reflect.getMetadata(DI_IMPORTS_SYMBOL, module);
        const providers: Set<any> = Reflect.getMetadata(DI_PROVIDERS_SYMBOL, module);
        const moduleViews: Set<Type<AbstractComponent> | Promise<Type<AbstractComponent>>> = Reflect.getMetadata(DI_VIEWS_SYMBOL, module);

        const providersMap = new Map();

        const importedModules = [];

        for (const importedModuleOrPromise of imports) {
            const importedModule = await this.getAsyncExport(importedModuleOrPromise);

            let moduleInstance: ModuleInstance = this.moduleInstances.get(importedModule);

            if (!moduleInstance) {
                moduleInstance = await this.createModule(importedModule);
                this.moduleInstances.set(importedModule, moduleInstance);
            }

            importedModules.push(moduleInstance);
        }

        const moduleInstance = new ModuleInstance(
            importedModules,
            providersMap,
            Array.from(this.routeViews),
        );

        const registeredProviders = Array
            .from(providers)
            .map((Provider) => {
                return {
                    clazz: Provider,
                    instance: this.createProvider(Provider, providers, moduleInstance),
                };
            });

        registeredProviders.forEach((data) => {
            const { clazz, instance } = data;
            moduleInstance.providers.set(clazz, instance);
        });

        for (const moduleView of moduleViews) {
            const View = await this.getAsyncExport<Type<AbstractComponent>>(moduleView);

            const metadataValue: ViewMetadata = Reflect.getMetadata(DI_VIEWS_SYMBOL, View);
            const { options } = metadataValue;
            const instance = this.createView(View, moduleInstance);

            this.routeViews.add({ instance, options, clazz: View } as ViewItem);
        }

        return moduleInstance;
    }

    private async getAsyncExport<T>(objectOrPromise: T | Promise<T>): Promise<T> {
        if (isPromise(objectOrPromise)) {
            const importedObject: any = await objectOrPromise;

            if (typeof importedObject !== 'object') {
                return null;
            }

            const [moduleKey] = Object.keys(importedObject);

            if (!moduleKey) {
                return null;
            }

            return importedObject[moduleKey];
        }

        return objectOrPromise;
    }

    private createProvider(Provider: any, providers: Set<any>, moduleInstance: ModuleInstance) {
        let providerInstance = moduleInstance.providers.get(Provider);

        if (providerInstance) {
            return providerInstance;
        }

        const deps: Array<any> = Reflect.getMetadata(DI_DEPS_SYMBOL, Provider);

        if (!deps) {
            throw new Error(`No provider named ${Provider.name}, did you add @Injectable() to this provider?`);
        }

        const args = deps.map((dep) => {
            let depInstance = moduleInstance.providers.get(dep);

            if (!depInstance) {
                if (providers.has(dep)) {
                    depInstance = this.createProvider(dep, providers, moduleInstance);
                } else {
                    moduleInstance.imports.some((imp) => {
                        depInstance = this.createProvider(dep, new Set(), imp);
                        return !!depInstance;
                    });
                }
            }

            if (!depInstance) {
                throw new Error(`Cannot found provider ${dep.name}`);
            }

            return depInstance;
        });

        providerInstance = new Provider(...args);

        return providerInstance;
    }

    private createView(View: Type<AbstractComponent>, moduleInstance: ModuleInstance) {
        const metadataValue: ViewMetadata = Reflect.getMetadata(DI_VIEWS_SYMBOL, View);
        const providersMap: Map<any, any> = moduleInstance.providers;
        const importedModules = moduleInstance.imports;

        const { dependencies: deps } = metadataValue;

        if (!deps) {
            throw new Error(`No provider named ${View.name}, did you add @View() to this provider?`);
        }

        const args = deps.map((dep: any) => {
            let depInstance = providersMap.get(dep);

            if (!depInstance) {
                const moduleIndex = importedModules.findIndex((importedModule) => {
                    return Boolean(importedModule.providers.get(dep));
                });

                if (moduleIndex !== -1) {
                    depInstance = importedModules[moduleIndex].providers.get(dep);
                }
            }

            if (!depInstance) {
                throw new Error(`Dependency ${dep.name} not found, did you add it to 'imports' parameter?`);
            }

            return depInstance;
        });

        return new View(...args);
    }

    private normalizePath(path: string) {
        let newPath: string = path;

        if (
            !newPath.startsWith('/') &&
            !newPath.endsWith('*') &&
            !newPath.startsWith('*')
        ) {
            newPath = `/${path}`;
        }

        newPath = newPath
            .replace(/\/+/g, '')
            .replace(/\/+$/g, '');

        return newPath;
    }

    private createNestedRoute(): RouteConfig {
        const routeViews = Array.from(this.routeViews);

        for (const [index, routeView] of routeViews.entries()) {
            if (!routeView?.options?.parent) {
                this.nestedRoute.push(this.createRouteConfigItem(routeView));
                routeViews.splice(index, 1);
            }
        }

        while (routeViews.length > 0) {
            const currentRouteView = routeViews.shift();

            const routeConfigItem = this.createRouteConfigItem(currentRouteView);

            const succeeded = this.setToParentRouteView(
                this.nestedRoute,
                routeConfigItem,
                currentRouteView.options?.parent,
            );

            if (!succeeded) {
                throw new Error(`Cannot find parent view for ${currentRouteView.clazz.name}`);
            }
        }

        return this.nestedRoute;
    }

    private createRouteConfigItem(routeView: ViewItem): RouteConfigItem {
        const {
            options,
            clazz,
        } = routeView;

        const {
            name,
            extra,
            pathname,
        } = options;

        const result: RouteConfigItem = {
            name,
            ViewClass: clazz,
            component: null,
            path: this.normalizePath(pathname),
            ...(
                typeof extra === 'undefined'
                    ? {}
                    : { extra }
            ),
        };

        if (routeView?.instance && typeof routeView.instance.getComponent === 'function') {
            result.component = routeView.instance.getComponent();
        }

        return result;
    }

    private setToParentRouteView(
        routes: RouteConfigItem[],
        routeConfigItem: RouteConfigItem,
        ParentViewComponent: Type<AbstractComponent>,
    ): boolean {
        for (const currentRouteConfigItem of routes) {
            const {
                ViewClass,
            } = currentRouteConfigItem;

            if (ViewClass === ParentViewComponent) {
                if (!Array.isArray(currentRouteConfigItem.children)) {
                    currentRouteConfigItem.children = [];
                }

                currentRouteConfigItem.children.push(routeConfigItem);

                return true;
            } else {
                if (Array.isArray(currentRouteConfigItem.children)) {
                    return this.setToParentRouteView(
                        currentRouteConfigItem.children,
                        routeConfigItem,
                        ParentViewComponent,
                    );
                }
            }
        }

        return false;
    }
}
