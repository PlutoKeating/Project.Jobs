import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Shell } from './components/Shell.tsx';
import { WorldPage } from './pages/World.tsx';
import { PeoplePage } from './pages/People.tsx';
import { PersonPage } from './pages/Person.tsx';
import { AppsPage } from './pages/Apps.tsx';
import { AppReportPage } from './pages/AppReport.tsx';
import { StudiesPage } from './pages/Studies.tsx';
import { StudyPage } from './pages/Study.tsx';
import { SessionPage } from './pages/Session.tsx';
import { HumanPage } from './pages/Human.tsx';

const root = createRootRoute({ component: Shell });
const P = () => root;
const world = createRoute({ getParentRoute: P, path: '/', component: WorldPage, validateSearch: (s: Record<string, unknown>): { focus?: string; place?: string } => ({ focus: typeof s.focus === 'string' ? s.focus : undefined, place: typeof s.place === 'string' ? s.place : undefined }) });
const people = createRoute({ getParentRoute: P, path: '/people', component: PeoplePage });
const person = createRoute({ getParentRoute: P, path: '/people/$id', component: PersonPage });
const appsR = createRoute({ getParentRoute: P, path: '/apps', component: AppsPage });
const appR = createRoute({ getParentRoute: P, path: '/apps/$id', component: AppReportPage });
const studies = createRoute({ getParentRoute: P, path: '/studies', component: StudiesPage });
const study = createRoute({ getParentRoute: P, path: '/studies/$id', component: StudyPage });
const session = createRoute({ getParentRoute: P, path: '/sessions/$id', component: SessionPage });
const human = createRoute({ getParentRoute: P, path: '/human', component: HumanPage });

export const router = createRouter({
  routeTree: root.addChildren([world, people, person, appsR, appR, studies, study, session, human]),
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' { interface Register { router: typeof router } }
