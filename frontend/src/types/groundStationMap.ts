import { LatLngPoint } from './mission';

export type MapLayerType = 'street' | 'satellite' | 'topo' | 'dark';

export type MissionDrawingTool =
  | 'select'
  | 'point'
  | 'path'
  | 'polygon'
  | 'circle'
  | 'concentric_circle'
  | 'draw'
  | 'set_home';

export type MissionType =
  | 'WAYPOINTS'
  | 'PATH'
  | 'POLYGON_GRID'
  | 'CIRCLE'
  | 'CONCENTRIC_CIRCLE'
  | 'DRAWN_PATH'
  | 'SEARCH'
  | 'CUSTOM_ROUTE';

export type ReturnBehavior = 'DIRECT_RTL' | 'SAME_PATH_BACK' | 'CUSTOM_RETURN_PATH' | 'LAND_AT_HOME';

export type MissionCategory = 'CUSTOM_ROUTE' | 'GRID_SEARCH' | 'CIRCLE_INVESTIGATION' | 'TARGET_MISSION';

export interface GroundStationWaypoint {
  id: string;
  index: number;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  action?: 'TAKEOFF' | 'NAVIGATE' | 'LOITER' | 'SURVEY_PASS' | 'ORBIT' | 'RTL' | 'LAND';
  name?: string;
  distanceFromPreviousMeters?: number;
  isCompleted?: boolean;
  isActive?: boolean;
  leg?: 'OUTBOUND' | 'RETURN';
}

export interface GroundStationMission {
  id: string;
  homePoint: {
    latitude: number;
    longitude: number;
    altitude: number;
    isSet: boolean;
  };
  missionType: MissionType;
  missionCategory?: MissionCategory;
  altitude: number; // Planned mission cruise altitude (meters)
  speed: number;    // Planned mission speed (m/s)
  waypoints: GroundStationWaypoint[];
  outboundWaypoints?: GroundStationWaypoint[];
  returnWaypoints?: GroundStationWaypoint[];
  returnBehavior?: ReturnBehavior;
  currentWaypointIndex?: number;
  currentLeg?: 'OUTBOUND' | 'TARGET_HOVER' | 'RETURN';
  totalDistance: number;          // Total route distance in meters
  estimatedDuration: number;      // Total estimated duration in seconds
  geometry?: {
    type: 'point' | 'path' | 'polygon' | 'circle';
    coordinates?: LatLngPoint[];
    circleCenter?: LatLngPoint;
    circleRadiusMeters?: number;
    areaSquareMeters?: number;
    returnCoordinates?: LatLngPoint[];
  };
  isUploaded: boolean;
  createdAt: number;
}

export type GroundStationStateLabel =
  | 'Disconnected'
  | 'Connected'
  | 'Ready'
  | 'Mission Created'
  | 'Mission Uploaded'
  | 'Armed'
  | 'Taking Off'
  | 'Executing Mission'
  | 'Paused'
  | 'Returning'
  | 'Completed'
  | 'Aborted'
  | 'Error';

export interface MapSearchResult {
  displayName: string;
  lat: number;
  lng: number;
  type?: string;
}
