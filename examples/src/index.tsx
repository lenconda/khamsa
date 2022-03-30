import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import reportWebVitals from './reportWebVitals';
import { App } from '../../lib';
import { HashRouter as Router } from 'react-router-dom';
import { AppModule } from './app.module';

ReactDOM.render(
    <App
        module={AppModule}
        RouterComponent={Router}
    />,
    document.getElementById('root'),
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
