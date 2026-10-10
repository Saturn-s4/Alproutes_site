import type { components } from './schema';

type S = components['schemas'];

export type LocalizedText = S['LocalizedText'];
export type Grade = S['Grade'];
export type GradeSystem = S['GradeSystem'];
export type AreaRef = S['AreaRef'];
export type AreaSummary = S['AreaSummary'];
export type Area = S['Area'];
export type RouteSummary = S['RouteSummary'];
export type RouteDetail = S['RouteDetail'];
export type RouteFeature = S['RouteFeature'];
export type RouteFeatureKind = S['RouteFeatureKind'];
export type RouteMapPoint = S['RouteMapPoint'];
export type RouteType = S['RouteType'];
export type TokenPair = S['TokenPair'];
export type User = S['User'];
export type UserRole = S['UserRole'];
export type Problem = S['Problem'];
export type Photo = S['Photo'];
export type PhotoKind = S['PhotoKind'];
export type RouteContentPhoto = S['RouteContentPhoto'];
export type Document = S['Document'];
export type RightsStatus = S['RightsStatus'];
export type SourceType = S['Document']['sourceType'];
