import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { Shell } from './components/Shell.tsx';
import { WorldPage } from './pages/World.tsx';
import { PeoplePage } from './pages/People.tsx';
import { PersonPage } from './pages/Person.tsx';
import { ProductsPage } from './pages/Products.tsx';
import { LaunchPage } from './pages/Launch.tsx';
import { SessionPage } from './pages/Session.tsx';
import { HumanPage } from './pages/Human.tsx';
import { SETTINGS_TABS, SettingsPage, type SettingsTab } from './pages/Settings.tsx';

const root = createRootRoute({ component: Shell });
const P = () => root;
const world = createRoute({ getParentRoute: P, path: '/', component: WorldPage, validateSearch: (s: Record<string, unknown>): { focus?: string; place?: string } => ({ focus: typeof s.focus === 'string' ? s.focus : undefined, place: typeof s.place === 'string' ? s.place : undefined }) });
const people = createRoute({ getParentRoute: P, path: '/people', component: PeoplePage });
const person = createRoute({ getParentRoute: P, path: '/people/$id', component: PersonPage });
const products = createRoute({ getParentRoute: P, path: '/products', component: ProductsPage });
const TABS = ['verdict', 'people', 'voices', 'engineering'] as const;
const launch = createRoute({ getParentRoute: P, path: '/products/$id', component: LaunchPage, validateSearch: (s: Record<string, unknown>): { tab?: (typeof TABS)[number] } => ({ tab: TABS.find((x) => x === s.tab && x !== 'verdict') }) });
// 模型接入并入了设置；旧链接 /models 跳到「设置 › 模型」
const models = createRoute({ getParentRoute: P, path: '/models', beforeLoad: () => { throw redirect({ to: '/settings', replace: true }); } });
const session = createRoute({ getParentRoute: P, path: '/sessions/$id', component: SessionPage });
const human = createRoute({ getParentRoute: P, path: '/human', component: HumanPage });
const settings = createRoute({ getParentRoute: P, path: '/settings', component: SettingsPage, validateSearch: (s: Record<string, unknown>): { tab?: SettingsTab } => ({ tab: SETTINGS_TABS.find((x) => x === s.tab && x !== 'models') }) });

export const router = createRouter({
  routeTree: root.addChildren([world, products, launch, people, person, session, human, models, settings]),
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' { interface Register { router: typeof router } }
