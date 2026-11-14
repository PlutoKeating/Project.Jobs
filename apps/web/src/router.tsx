import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Shell } from './components/Shell.tsx';
import { WorldPage } from './pages/World.tsx';
import { PeoplePage } from './pages/People.tsx';
import { PersonPage } from './pages/Person.tsx';
import { ProductsPage } from './pages/Products.tsx';
import { LaunchPage } from './pages/Launch.tsx';
import { SessionPage } from './pages/Session.tsx';
import { HumanPage } from './pages/Human.tsx';

const root = createRootRoute({ component: Shell });
const P = () => root;
const world = createRoute({ getParentRoute: P, path: '/', component: WorldPage, validateSearch: (s: Record<string, unknown>): { focus?: string; place?: string } => ({ focus: typeof s.focus === 'string' ? s.focus : undefined, place: typeof s.place === 'string' ? s.place : undefined }) });
const people = createRoute({ getParentRoute: P, path: '/people', component: PeoplePage });
const person = createRoute({ getParentRoute: P, path: '/people/$id', component: PersonPage });
const products = createRoute({ getParentRoute: P, path: '/products', component: ProductsPage });
const TABS = ['verdict', 'people', 'voices', 'engineering'] as const;
const launch = createRoute({ getParentRoute: P, path: '/products/$id', component: LaunchPage, validateSearch: (s: Record<string, unknown>): { tab?: (typeof TABS)[number] } => ({ tab: TABS.find((x) => x === s.tab && x !== 'verdict') }) });
const session = createRoute({ getParentRoute: P, path: '/sessions/$id', component: SessionPage });
const human = createRoute({ getParentRoute: P, path: '/human', component: HumanPage });

export const router = createRouter({
  routeTree: root.addChildren([world, products, launch, people, person, session, human]),
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' { interface Register { router: typeof router } }
