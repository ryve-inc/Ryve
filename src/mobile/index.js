// index.js — React Native entry point
import { AppRegistry } from 'react-native'
import { App } from './src/mobile/App'
import { name as appName } from './app.json'

AppRegistry.registerComponent(appName, () => App)
