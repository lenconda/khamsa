import { Component } from '@agros/common';
import { LoremService } from './lorem.service';

@Component({
    file: './Lorem',
    lazy: true,
    declarations: [
        LoremService,
    ],
})
export class LoremComponent {}
