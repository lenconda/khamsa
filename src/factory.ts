import 'reflect-metadata';
import React from 'react';
import {
    AbstractComponent,
    ModuleInstance,
    ComponentInstance,
} from './classes';
import {
    DI_DEPS_SYMBOL,
    DI_GLOBAL_MODULE_SYMBOL,
    DI_METADATA_COMPONENT_SYMBOL,
    DI_METADATA_MODULE_SYMBOL,
} from './constants';
import {
    ComponentMetadata,
    LazyLoadHandler,
    ModuleMetadata,
    RouteConfig,
    RouteConfigItem,
    RouteOptionItem,
    RouterItem,
    Type,
    ViewItem,
} from './types';
import isPromise from 'is-promise';
import isFunction from 'lodash/isFunction';
import isString from 'lodash/isString';

export class Factory {
    /**
     * @private
     * temporarily save flattened view items
     */
    private routeViews: Set<ViewItem> = new Set();
    /**
     * @private
     * the nested route for the whole application
     */
    private nestedRoute: RouteConfigItem[] = [];
    /**
     * @private
     * the flattened map for all module instances created from module classes
     */
    private moduleInstanceMap = new Map<Type<any>, ModuleInstance>();
    /**
     * @private
     * the flattened map for all provider instances exported by modules
     */
    private providerInstanceMap = new Map<Type<any>, any>();
    /**
     * @private
     * the flattened map for all provider instances provided by modules
     */
    private componentInstanceMap = new Map<Type<any>, ComponentInstance>();
    /**
     * @private
     * a map for storing provider class to module class relationship
     */
    private providerClassToModuleClassMap = new Map<Type, Type>();
    /**
     * @private
     * a map for storing component class to module class relationship
     */
     private componentClassToModuleClassMap = new Map<Type, Type>();
    /**
     * @private
     * flattened route config items
     */
    // private routeConfigItems: RouteConfigItem[] = [];
    private routerItems: RouterItem[] = [];

    /**
     * @public
     * @async
     * @method
     * @param {Type<T>} ModuleClass
     * @returns {Promise<RouteConfig>}
     *
     * create a route config with the root module
     */
    public async create<T = any>(ModuleClass: Type<T>): Promise<RouterItem[]> {
        const rootModuleInstance = await this.createModuleInstance(ModuleClass);
        this.setImportedModuleInstances();
        this.createProviderClassToModuleClassMap();
        await this.createProviderInstances(rootModuleInstance);
        this.createComponentInstances(rootModuleInstance);
        this.generateReactComponentForInstances();
        this.routerItems = this.createRoutes(Array.from(rootModuleInstance.metadata.routes));
        return Array.from(this.routerItems);
    }

    /**
     * @param {Type<T>} ModuleClass
     * @returns {Promise<void>}
     *
     * create flattened module instances using a root module class
     * this is a recursive function
     */
    private async createModuleInstance<T>(ModuleClass: Type<T>) {
        if (!this.moduleInstanceMap.get(ModuleClass)) {
            const metadataValue: ModuleMetadata = Reflect.getMetadata(
                DI_METADATA_MODULE_SYMBOL,
                ModuleClass,
            );
            const isGlobal: boolean = Reflect.getMetadata(DI_GLOBAL_MODULE_SYMBOL, ModuleClass) || false;

            const {
                imports,
                providers,
                routes,
                components,
                exports: exportedProviders,
            } = metadataValue;

            /**
             * create current module instance by module class
             */
            const moduleInstance = new ModuleInstance({
                Class: ModuleClass,
                isGlobal,
                imports: new Set(imports),
                providers: new Set(providers),
                exports: new Set(exportedProviders),
                routes: new Set(routes),
                components: new Set(components),
            });

            this.moduleInstanceMap.set(ModuleClass, moduleInstance);
        }

        const currentModuleInstance = this.moduleInstanceMap.get(ModuleClass);

        /**
         * get all imported module classes and create them recursively
         */
        for (const ImportedModuleClassOrPromise of currentModuleInstance.metadata.imports) {
            await this.createModuleInstance(ImportedModuleClassOrPromise);
        }

        return currentModuleInstance;
    }

    /**
     * @private
     * @async
     * @returns {Promise<void>}
     *
     * add imported module instances into every instance
     */
    private setImportedModuleInstances() {
        for (const [ModuleClass, moduleInstance] of this.moduleInstanceMap.entries()) {
            for (const ImportedModuleClass of Array.from(moduleInstance.metadata.imports)) {
                if (ModuleClass === ImportedModuleClass) {
                    throw new Error(`Module ${ModuleClass.name} cannot import itself`);
                }

                const importedModuleInstance = this.moduleInstanceMap.get(ImportedModuleClass);

                if (!importedModuleInstance) {
                    throw new Error(`Module ${ImportedModuleClass.name} cannot be imported into ${ModuleClass.name}`);
                }

                moduleInstance.addImportedModuleInstance(importedModuleInstance);
            }

            /**
             * if current module is declared to be global, the module instance will be
             * added to all listed module instances except itself
             */
            if (moduleInstance.metadata.isGlobal) {
                for (const [TargetModuleClass, targetModuleInstance] of this.moduleInstanceMap.entries()) {
                    if (TargetModuleClass !== ModuleClass) {
                        targetModuleInstance.addImportedModuleInstance(moduleInstance);
                    }
                }
            }
        }
    }

    /**
     * @private
     * @returns {void}
     *
     * create a map for mapping provider class to module classes
     * in order to make it easier to find a module class who
     * provides a provider class
     */
    private createProviderClassToModuleClassMap() {
        for (const [, moduleInstance] of this.moduleInstanceMap) {
            for (const ProviderClass of moduleInstance.metadata.providers) {
                this.providerClassToModuleClassMap.set(ProviderClass, moduleInstance.metadata.Class);
            }
        }
    }

    /**
     * @private
     * @async
     * @returns {void}
     *
     * create a single provider instance use provider class
     */
    private async createProviderInstance(ProviderClass: Type) {
        if (this.providerInstanceMap.get(ProviderClass)) {
            return this.providerInstanceMap.get(ProviderClass);
        }

        const ModuleClass = this.providerClassToModuleClassMap.get(ProviderClass);
        const moduleInstance = this.moduleInstanceMap.get(ModuleClass);

        const dependedProviderClasses = Reflect.getMetadata(DI_DEPS_SYMBOL, ProviderClass) as Type[];

        if (!Array.isArray(dependedProviderClasses)) {
            throw new Error(`Provider ${ProviderClass.name} cannot be injected, did you add \`@Injectable()\` into it?`);
        }

        /**
         * set to provider instance map directly so that other provider
         * who depends on it can get it during creating provider instances,
         * even if it does not be fully created.
         */
        this.providerInstanceMap.set(
            ProviderClass,
            new ProviderClass(
                ...await Promise.all(dependedProviderClasses.map((DependedProviderClass) => {
                    if (DependedProviderClass === ProviderClass) {
                        throw new Error(`Provider ${ProviderClass.name} cannot depend on itself`);
                    }

                    const DependedModuleClass = this.providerClassToModuleClassMap.get(DependedProviderClass);

                    if (!moduleInstance.hasDependedProviderClass(DependedProviderClass)) {
                        throw new Error(
                            `Cannot inject provider ${DependedProviderClass.name} into provider ${ProviderClass.name}, did you import ${DependedModuleClass.name}?`,
                        );
                    }

                    return this.createProviderInstance(DependedProviderClass);
                })),
            ),
        );

        return this.providerInstanceMap.get(ProviderClass);
    }

    /**
     * @private
     * @async
     * @returns {Promise<void}
     *
     * create provider instances from root module's providers
     */
    private async createProviderInstances(moduleInstance: ModuleInstance) {
        for (const ProviderClass of Array.from(moduleInstance.metadata.providers)) {
            await this.createProviderInstance(ProviderClass);
        }

        for (const importedModuleInstance of Array.from(moduleInstance.getImportedModuleInstances())) {
            await this.createProviderInstances(importedModuleInstance);
        }
    }

    /**
     * @utility
     * @private
     * @async
     * @returns {Promise<T>}
     *
     * get async exports from a promise object
     */
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

    private createComponentInstances(moduleInstance: ModuleInstance) {
        const ModuleClass = moduleInstance.metadata.Class;

        for (const ComponentClass of Array.from(moduleInstance.metadata.components)) {
            this.componentClassToModuleClassMap.set(ComponentClass, ModuleClass);

            const metadataValue: ComponentMetadata = Reflect.getMetadata(
                DI_METADATA_COMPONENT_SYMBOL,
                ComponentClass,
            );

            const componentInstance = new ComponentInstance({
                ...metadataValue,
                Class: ComponentClass,
            });

            this.componentInstanceMap.set(ComponentClass, componentInstance);
        }

        for (const importedModuleInstance of Array.from(moduleInstance.getImportedModuleInstances())) {
            this.createComponentInstances(importedModuleInstance);
        }
    }

    private generateReactComponent(componentInstance: ComponentInstance) {
        const component = componentInstance.getComponent();

        if (component) {
            return component;
        }

        const generateDependencyMap = () => {
            const ComponentClass = componentInstance.metadata.Class;

            const dependedProviderClasses: Type[] = Reflect.getMetadata(
                DI_DEPS_SYMBOL,
                componentInstance.metadata.Class,
            ) || [];

            const moduleInstance = this.moduleInstanceMap.get(this.componentClassToModuleClassMap.get(ComponentClass));
            const dependencyMap = new Map<Type, any>();

            for (const ProviderClass of dependedProviderClasses) {
                if (this.componentInstanceMap.get(ProviderClass)) {
                    const dependedComponentInstance = this.componentInstanceMap.get(ProviderClass);
                    let dependedComponent = dependedComponentInstance.getComponent();

                    if (!dependedComponent) {
                        dependedComponent = this.generateReactComponent(dependedComponentInstance);
                    }

                    dependencyMap.set(ProviderClass, dependedComponent);
                } else {
                    if (moduleInstance.hasDependedProviderClass(ProviderClass)) {
                        dependencyMap.set(ProviderClass, this.providerInstanceMap.get(ProviderClass));

                        if (!dependencyMap.get(ProviderClass)) {
                            throw new Error(`Cannot find provider ${ProviderClass.name} that can be injected`);
                        }
                    } else {
                        throw new Error(`Cannot inject provider ${ProviderClass.name} into component ${ComponentClass.name}`);
                    }
                }
            }

            return dependencyMap;
        };

        componentInstance.setComponent((props: any) => {
            return React.createElement(
                componentInstance.metadata.component,
                {
                    ...props,
                    $declarations: generateDependencyMap(),
                },
            );
        });
    }

    private generateReactComponentForInstances() {
        for (const [, componentInstance] of this.componentInstanceMap.entries()) {
            this.generateReactComponent(componentInstance);
        }
    }

    private normalizePath(path: string, topLeveled = false) {
        let newPath: string = path;

        newPath = newPath.replace(/^.+\/+$/g, '');

        if (!topLeveled) {
            newPath = newPath.replace(/^\/+/g, '');
        }

        return newPath;
    }

    private createRoutes(routes: RouteOptionItem[], prefixPathname = ''): RouterItem[] {
        return Array.from(routes).reduce((routes, routeItem) => {
            const {
                useComponentClass,
                useModuleClass,
                children,
                path: pathname = '',
                ...options
            } = routeItem;

            let currentPathname = '';

            if (!this.normalizePath(prefixPathname)) {
                currentPathname = this.normalizePath(pathname);
            } else if (!this.normalizePath(pathname)) {
                currentPathname = this.normalizePath(prefixPathname);
            } else {
                currentPathname = `${this.normalizePath(prefixPathname)}/${this.normalizePath(pathname)}`;
            }

            if (useComponentClass && useModuleClass) {
                throw new Error('\'useComponentClass\' and \'useModuleClass\' are not permitted to be specified at one time');
            }

            if (!useComponentClass && !useModuleClass) {
                throw new Error('\'useComponentClass\' or \'useModuleClass\' should be specified');
            }

            if (useComponentClass) {
                const ComponentClass = useComponentClass;
                const currentRouterItem = {
                    ...options,
                    path: currentPathname,
                    componentInstance: this.componentInstanceMap.get(ComponentClass),
                } as RouterItem;

                if (Array.isArray(children)) {
                    currentRouterItem.children = this.createRoutes(routeItem.children);
                }

                return routes.concat(currentRouterItem);
            } else if (useModuleClass) {
                const ModuleClass = useModuleClass;
                const moduleInstance = this.moduleInstanceMap.get(ModuleClass);
                const currentRoutes = Array.from(moduleInstance.metadata.routes);
                return routes
                    .concat(this.createRoutes(currentRoutes, this.normalizePath(prefixPathname) || ''))
                    .map((routerItem) => {
                        if (Array.isArray(routeItem.children)) {
                            routerItem.children = this.createRoutes(routerItem.children);
                        }

                        return routerItem;
                    });
            } else {
                return routes;
            }
        }, [] as RouterItem[]);
    }

    // /**
    //  * @private
    //  * @async
    //  * @returns {Promise<void>}
    //  *
    //  * create views declared by all module instances
    //  */
    // private async createViews(moduleInstance: ModuleInstance) {
    //     for (const ViewClassOrConfig of Array.from(moduleInstance.metadata.views)) {
    //         let data = {
    //             component: null,
    //             options: null,
    //             lazyLoad: false,
    //         } as ViewItem;

    //         const {
    //             provider: viewClassOrPromise,
    //             ...options
    //         } = ViewClassOrConfig;

    //         data.options = options;

    //         if (!viewClassOrPromise.hasOwnProperty('arguments') && Boolean(viewClassOrPromise.prototype)) {
    //             const ViewClass = viewClassOrPromise as Type<AbstractComponent>;
    //             const instance = this.createViewInstance(ViewClass, moduleInstance);

    //             if (isFunction(instance.getComponent)) {
    //                 data.component = await instance.getComponent();
    //             }
    //         } else {
    //             const lazyLoadHandler = viewClassOrPromise as LazyLoadHandler;

    //             Object.defineProperty(this, 'moduleInstance', {
    //                 value: moduleInstance,
    //                 writable: false,
    //             });

    //             const lazyLoadFactory = await lazyLoadHandler(this.parseLazyLoadViewClass.bind(this));

    //             if (!isFunction(lazyLoadFactory)) {
    //                 throw new Error('Lazy load provider must return a React lazy load factory');
    //             }

    //             data.lazyLoad = true;
    //             data.component = React.lazy(lazyLoadFactory);
    //         }

    //         this.routeViews.add(data);
    //     }

    //     for (const importedModuleInstance of Array.from(moduleInstance.getImportedModuleInstances())) {
    //         await this.createViews(importedModuleInstance);
    //     }
    // }

    // private parseLazyLoadViewClass(lazyLoadPromise: Promise<any>): Promise<any> {
    //     return new Promise((resolve) => {
    //         const moduleInstance = (this as any).moduleInstance as ModuleInstance;

    //         this
    //             .getAsyncExport<Type<AbstractComponent>>(lazyLoadPromise)
    //             .then((ViewClass) => {
    //                 const instance = this.createViewInstance(ViewClass, moduleInstance);
    //                 if (isFunction(instance.getComponent)) {
    //                     instance.getComponent().then((component) => {
    //                         resolve({ default: component });
    //                     });
    //                 }
    //             });
    //     });
    // }

    // private createViewInstance(ViewClass: Type<AbstractComponent>, moduleInstance: ModuleInstance) {
    //     const dependedProviderClasses: Type[] = Reflect.getMetadata(DI_DEPS_SYMBOL, ViewClass) || [];

    //     const viewInstance = new ViewClass(...dependedProviderClasses.map((DependedProviderClass) => {
    //         const DependedModuleClass = this.providerClassToModuleClassMap.get(DependedProviderClass);

    //         if (!moduleInstance.hasDependedProviderClass(DependedProviderClass)) {
    //             throw new Error(
    //                 `Cannot inject provider ${DependedProviderClass.name} into view ${ViewClass.name}, did you import ${DependedModuleClass.name}?`,
    //             );
    //         }

    //         const providerInstance = this.providerInstanceMap.get(DependedProviderClass);

    //         if (!providerInstance) {
    //             throw new Error(
    //                 `Cannot find provider instance for ${DependedProviderClass.name}`,
    //             );
    //         }

    //         return providerInstance;
    //     }));

    //     return viewInstance;
    // }

    // private normalizePath(path: string, topLeveled = false) {
    //     let newPath: string = path;

    //     newPath = newPath.replace(/^.+\/+$/g, '');

    //     if (!topLeveled) {
    //         newPath = newPath.replace(/^\/+/g, '');
    //     }

    //     return newPath;
    // }

    // private createNestedRoute() {
    //     const routeViews = Array.from(this.routeViews);

    //     for (const routeView of routeViews) {
    //         const {
    //             options = {
    //                 id: null,
    //                 path: null,
    //             },
    //         } = routeView;

    //         const {
    //             id,
    //             path: pathname,
    //             parent,
    //         } = options;

    //         if (!pathname) {
    //             throw new Error('View should have `path` value');
    //         }

    //         if (!id) {
    //             throw new Error('View should have `id` value');
    //         }

    //         if (parent && !isString(parent)) {
    //             throw new Error(`'parent' should be a string in ${id}`);
    //         }

    //         if (parent && parent === id) {
    //             throw new Error(`View '${id}' cannot be a child of itself`);
    //         }

    //         const routeConfigItem = this.createRouteConfigItem(routeView);
    //         routeConfigItem.path = this.normalizePath(routeConfigItem.path, !routeConfigItem.parent);

    //         if (this.routeConfigItems.some((item) => item.id === routeConfigItem.id)) {
    //             throw new Error(`View '${id}' has at least one duplicated instance`);
    //         }

    //         this.routeConfigItems.push(routeConfigItem);
    //     }

    //     for (const routeConfigItem of this.routeConfigItems) {
    //         if (!this.setToParentRouteConfigItem(this.routeConfigItems, routeConfigItem)) {
    //             const {
    //                 id,
    //                 parent,
    //             } = routeConfigItem;
    //             throw new Error(`Cannot find view id '${parent}' for view '${id}'`);
    //         }
    //     }

    //     return this.routeConfigItems.filter((item) => !item.parent);
    // }

    // private sequenceNestedRoute(nestedRoutes: RouteConfig) {
    //     const newNestedRoutes = nestedRoutes.sort((a, b) => {
    //         return (b.priority || 0) * (b.sequence || 1) - (a.priority || 0) * (a.sequence || 1);
    //     });

    //     for (const nestedRouteItem of newNestedRoutes) {
    //         if (Array.isArray(nestedRouteItem.children) && nestedRouteItem.children.length > 0) {
    //             nestedRouteItem.children = this.sequenceNestedRoute(nestedRouteItem.children);
    //         }
    //     }

    //     return newNestedRoutes;
    // }

    // private createRouteConfigItem(routeView: ViewItem): RouteConfigItem {
    //     const {
    //         options,
    //         component,
    //         lazyLoad = false,
    //     } = routeView;

    //     const {
    //         elementProps,
    //         priority = 0,
    //         path: pathname,
    //         ...otherOptions
    //     } = options;

    //     const result: RouteConfigItem = {
    //         component,
    //         priority,
    //         lazyLoad,
    //         path: pathname,
    //         ...otherOptions,
    //         ...(
    //             typeof elementProps === 'undefined'
    //                 ? {}
    //                 : { elementProps }
    //         ),
    //     };

    //     return result;
    // }

    // private setToParentRouteConfigItem(
    //     routeConfigItems: RouteConfigItem[],
    //     routeConfigItem: RouteConfigItem,
    // ): boolean {
    //     if (!routeConfigItem.parent) {
    //         return true;
    //     }

    //     for (const parentRouteConfigItem of routeConfigItems) {
    //         if (routeConfigItem.parent === parentRouteConfigItem.id) {
    //             if (!Array.isArray(parentRouteConfigItem.children)) {
    //                 parentRouteConfigItem.children = [];
    //             }

    //             routeConfigItem.sequence = parentRouteConfigItem.children.length + 1;
    //             parentRouteConfigItem.children.push(routeConfigItem);

    //             return true;
    //         }
    //     }

    //     return false;
    // }
}
