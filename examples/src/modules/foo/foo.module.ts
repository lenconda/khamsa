import { Module } from '../../../../lib';
import { BarModule } from '../bar/bar.module';
import { FooService } from './foo.service';

@Module({
    imports: [
        BarModule,
    ],
    providers: [
        FooService,
    ],
    views: [
        {
            path: '/app/foo',
            view: import('./foo.view'),
            suspenseFallback: '/app/foo is loading...',
        },
        {
            path: '/app/foo/child',
            view: import('./foo-child.view'),
            suspenseFallback: '/app/foo/child is loading...',
        },
    ],
    exports: [
        FooService,
    ],
})
export class FooModule {}
