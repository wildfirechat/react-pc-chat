
import React, { Component } from 'react';
import { render } from 'react-dom';
import { Provider } from 'mobx-react';
import { HashRouter } from 'react-router-dom';
import { ipcRenderer, remote } from 'electron';

import './global.css';
import './assets/fonts/icomoon/style.css';
import 'utils/albumcolors';
import getRoutes from './js/ui/routes';
import stores from './js/ui/stores';

var sharedObj = remote.getGlobal('sharedObj');

export default class App extends Component {
    componentWillMount() {
        if (window.navigator.onLine) {
            // await stores.sessions.hasLogin();
            // await stores.settings.init();
            // await stores.search.getHistory();
            stores.wfc.init([sharedObj.proto]);
        }
    }

    canisend() {
        return this.refs.navigator.history.location.pathname === '/'
            && stores.chat.user;
    }

    componentDidMount() {
        var navigator = this.refs.navigator;

        // Hide the tray icon
        ipcRenderer.on('hide-tray', () => {
            stores.settings.setShowOnTray(false);
        });

        // Chat with user
        ipcRenderer.on('message-chatto', (event, args) => {
            var user = stores.contacts.memberList.find(e => e.UserName === args.id);

            navigator.history.push('/');
            setTimeout(stores.chat.chatTo(user));
        });

        // Show the user info
        ipcRenderer.on('show-userinfo', (event, args) => {
            var user = stores.contacts.memberList.find(e => e.UserName === args.id);
            stores.userinfo.toggle(true, user);
        });

        // Shwo the settings page
        ipcRenderer.on('show-settings', () => {
            navigator.history.push('/settings');
        });

        // Show a modal to create a new conversation
        ipcRenderer.on('show-newchat', () => {
            navigator.history.push('/');
            stores.newchat.toggle(true);
        });

        // Show the conversation pane
        ipcRenderer.on('show-conversations', () => {
            if (this.canisend()) {
                stores.chat.toggleConversation();
            }
        });

        // Search in currently conversation list
        ipcRenderer.on('show-search', () => {
            navigator.history.push('/');
            stores.chat.toggleConversation(true);

            setTimeout(() => document.querySelector('#search').focus());
        });

        // Show the home page
        ipcRenderer.on('show-messages', () => {
            navigator.history.push('/');
            stores.chat.toggleConversation(true);
        });

        ipcRenderer.on('file-downloaded', (event, msg) => {
            console.log('file-downloaded', msg);
            stores.chat.updateFileMessageContent(msg.messageId, msg.filePath);
        });

        ipcRenderer.on('file-download-progress', (event, msg) => {
            console.log('file-download-progress', msg);
            stores.chat.updateFileMessageDownloadProgress(msg.messageId, msg.filePath);
        });

        // Insert the qq emoji
        ipcRenderer.on('show-emoji', () => {
            if (this.canisend()) {
                document.querySelector('#showEmoji').click();
            }
        });

        // Show contacts page
        ipcRenderer.on('show-contacts', () => {
            navigator.history.push('/contacts');
        });

        // Go to next conversation
        ipcRenderer.on('show-next', () => {
            navigator.history.push('/');
            stores.chat.toggleConversation(true);
            setTimeout(stores.chat.chatToNext);
        });

        // Go to the previous conversation
        ipcRenderer.on('show-previous', () => {
            navigator.history.push('/');
            stores.chat.toggleConversation(true);
            setTimeout(stores.chat.chatToPrev);
        });

        // When the system resume reconnet to WeChat
        ipcRenderer.on('os-resume', async () => {
            var sessions = stores.sessions;

            console.log('os-resume' + new Date());
            setTimeout(() => {
                sessions.checkTimeout(true);
            }, 3000);
        });

        // Show the daemon error
        ipcRenderer.on('show-errors', (event, args) => {
            stores.snackbar.showMessage(args.message);
        });
    }

    render() {
        return (
            <Provider {...stores}>
                <HashRouter ref="navigator">
                    {getRoutes()}
                </HashRouter>
            </Provider>
        );
    }
}

// render(
//     <App />,
//     document.getElementById('root')
// );

module.exports = App
