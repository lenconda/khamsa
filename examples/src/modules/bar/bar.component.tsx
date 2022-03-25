import React from 'react';
import { Component } from '../../../../lib';

@Component({
    suspenseFallback: 'loading...',
    component: React.lazy(() => import('./Bar')),
})
export class BarComponent {}
