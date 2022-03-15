import {
    FunctionComponent,
    useEffect,
} from 'react';
import {
    AbstractComponent,
    View,
} from '../../../../lib';
import { BarComponent } from '../bar/bar.component';
import { BarService } from '../bar/bar.service';
import { FooService } from './foo.service';

@View({
    pathname: '/foo',
})
export class FooView extends AbstractComponent implements AbstractComponent {
    public constructor(
        protected readonly fooService: FooService,
        protected readonly barComponentService: BarComponent,
        protected readonly barService: BarService,
    ) {
        super();
    }

    protected injectServices(): Record<string, any> {
        const {
            fooService,
            barService,
            barComponentService,
        } = this;

        return {
            fooService,
            barService,
            barComponentService,
        };
    }

    protected generateComponent(injectedServices): FunctionComponent<any> {
        const BarComponent = injectedServices.barComponentService.getComponent();

        return () => {
            useEffect(() => {
                injectedServices.fooService.logHello();
                injectedServices.barService.sayHello();
            }, []);

            return (
                <>
                    <div>Khamsa is working!</div>
                    <BarComponent />
                </>
            );
        };
    }
}
