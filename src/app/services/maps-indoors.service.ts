import { Injectable } from '@angular/core';
import { GoogleMapService } from './google-map.service';
import { AppConfigService } from './app-config.service';
import { Observable, BehaviorSubject, Subscription, Subject } from 'rxjs';
import { SolutionService } from './solution.service';
import { UserAgentService } from './user-agent.service';
import { TrackerService } from './tracker.service';

import { Venue } from '../shared/models/venue.interface';
import { Location } from '../shared/models/location.interface';

declare const mapsindoors: any;

interface ReturnToValues {
    name: string,
    latLng: google.maps.LatLng,
    isVenue: boolean
}

@Injectable({
    providedIn: 'root'
})
export class MapsIndoorsService {
    mapsIndoors: any;
    appConfig: any;
    isMapDirty: boolean = false;

    public floorSelectorIsVisible = false;
    private floorSelectorPosition: google.maps.ControlPosition;
    private floorSelectorListener;

    private isHandsetSubscription: Subscription;
    private pageTitle = new BehaviorSubject<string>('');
    private returnToValues = new Subject<ReturnToValues>();

    constructor(
        private solutionService: SolutionService,
        private googleMapService: GoogleMapService,
        private appConfigService: AppConfigService,
        private userAgentService: UserAgentService,
        private trackerService: TrackerService
    ) {
        this.appConfigService.getAppConfig()
            .subscribe((appConfig): void => this.appConfig = appConfig);
    }

    // #region || SET MAPS INDOORS
    initMapsIndoors(): Promise<void> {
        return new Promise(async (resolve): Promise<void> => {

            this.mapsIndoors = await new mapsindoors.MapsIndoors({
                mapView: this.googleMapService.googleMapView,
                labelOptions: {
                    style: {
                        color: 'rgba(82,82,82,1)',
                        fontFamily: 'Open Sans',
                        fontSize: '12px',
                        fontWeight: 300,
                        shadowBlur: 3,
                        shadowColor: 'white'
                    }
                }
            });

            this.mapsIndoors.setDisplayRule(['MI_BUILDING', 'MI_VENUE'], { visible: false });

            // Set tittle attribute for map POI's
            this.solutionService.getSolution()
                .then((solution): void => {
                    for (const type of solution.types) {
                        this.mapsIndoors.setDisplayRule(type.name, { title: '{{name}}' });
                    }
                });

            // Add position control to the map and setup listeners on the user agent service.
            if (this.appConfig.appSettings.positioningDisabled !== '1') {
                const positionControlElement = document.createElement('div');
                this.userAgentService.positionControl = new mapsindoors.PositionControl(positionControlElement, { mapsIndoors: this.mapsIndoors, positionOptions: { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 } });
                this.googleMapService.map.controls[google.maps.ControlPosition.TOP_RIGHT].push(positionControlElement);

                this.userAgentService.positionControl.addListener('position_error', (error): void => {
                    this.userAgentService.positionError(error);
                });

                this.userAgentService.positionControl.addListener('position_received', (position) => {
                    this.userAgentService.positionReceived(position);
                });
            }

            // Hide Building Outline and FloorSelector if there are any 2.5D tiles available
            const buildingOutlineVisibleFrom: number = parseInt(this.appConfig.appSettings.buildingOutlineVisibleFrom);
            const floorSelectorVisibleFrom: number = parseInt(this.appConfig.appSettings.floorSelectorVisibleFrom);
            if (buildingOutlineVisibleFrom && floorSelectorVisibleFrom) {
                this.mapsIndoors.addListener('zoom_changed', (): void => {
                    const mapsIndoorsZoomLevel: number = this.mapsIndoors.getZoom();
                    // Building Outline
                    mapsIndoorsZoomLevel >= buildingOutlineVisibleFrom ? this.showBuildingOutline() : this.mapsIndoors.setBuildingOutlineOptions({ visible: false });
                    // Floor Selector
                    mapsIndoorsZoomLevel >= floorSelectorVisibleFrom ? this.showFloorSelector() : this.hideFloorSelector();
                });
            } else this.showBuildingOutline();
            resolve();
        });
    }

    /**
     * Set and show building outline.
     */
    showBuildingOutline(): void {
        this.mapsIndoors.setBuildingOutlineOptions({
            visible: true,
            clickable: false,
            fillOpacity: 0,
            strokeColor: '#EF6CCE',
            strokeOpacity: 1,
            strokeWeight: 4
        });
    }
    // #endregion

    // #region || FLOOR SELECTOR
    showFloorSelectorAfterUserInteraction(): void {
        const mapElement = document.getElementById('gmap');
        const eventsToListenFor = ['touchmove', 'click', 'wheel']; // these are events we consider as user interactions with the map

        const userInteracted = (): void => {
            eventsToListenFor.forEach(event => mapElement.removeEventListener(event, userInteracted));

            if (!this.floorSelectorIsVisible) {
                this.showFloorSelector();
            }
        };

        eventsToListenFor.forEach(event => mapElement.addEventListener(event, userInteracted));
    }


    /**
     * @description Creates a new floor selector.
     * @memberof MapsIndoorsService
     */
    showFloorSelector(): void {
        const floorSelectorDiv = document.createElement('div');
        new mapsindoors.FloorSelector(floorSelectorDiv, this.mapsIndoors);

        this.isHandsetSubscription = this.userAgentService.isHandset()
            .subscribe((isHandset: boolean) => {
                if (this.floorSelectorIsVisible) {
                    this.googleMapService.map.controls[this.floorSelectorPosition].clear();
                }

                this.floorSelectorPosition = isHandset ?
                    google.maps.ControlPosition.LEFT_CENTER :
                    google.maps.ControlPosition.RIGHT_CENTER;

                this.googleMapService.map.controls[this.floorSelectorPosition].push(floorSelectorDiv);
                this.floorSelectorIsVisible = true;
            });

        this.floorSelectorListener = this.trackFloorChange.bind(this);
        this.mapsIndoors.addListener('floor_changed', this.floorSelectorListener);
    }

    /**
     * @description Register floor change events on tracker service.
     */
    trackFloorChange(): void {
        this.trackerService.sendEvent('Floor selector', 'Floor was changed', `${this.mapsIndoors.getFloor()}th floor was set`, true);
    }

    /**
     * @description Removes the floor selector.
     * @memberof MapsIndoorsService
     */
    hideFloorSelector(): void {
        if (!this.floorSelectorIsVisible) {
            return;
        }

        this.googleMapService.map.controls[this.floorSelectorPosition].clear();
        this.floorSelectorIsVisible = false;
        this.mapsIndoors.removeListener('floor_changed', this.floorSelectorListener);
        this.isHandsetSubscription.unsubscribe();
    }

    /**
     * @description Sets the floor.
     * @param {string} floor - The new floor to be set.
     * @memberof MapsIndoorsService
     */
    setFloor(floor: string): void {
        if (this.mapsIndoors.getFloor() !== floor) {
            this.mapsIndoors.setFloor(floor);
        }
    }
    // #endregion

    // #region || RETURN
    /**
     * @description Set the values for return button.
     * @param {string} name
     * @param {google.maps.LatLng} latLng
     * @param {boolean} isVenue
     * @memberof MapsIndoorsService
     */
    private setReturnToValues(values: ReturnToValues): void {
        this.returnToValues.next(values);
    }

    /**
     * @description Sets the values for return to location button.
     * @param {Location} location – The selected location.
     * @memberof MapsIndoorsService
     */
    setLocationAsReturnToValue(location: Location, anchorCoordinates: google.maps.LatLng): void {
        const values: ReturnToValues = {
            name: location.properties.name,
            latLng: anchorCoordinates,
            isVenue: false
        };
        this.setReturnToValues(values);
    }

    /**
     * @description Sets the values for return to venue button.
     * @param {Venue} venue The selected venue.
     * @memberof MapsIndoorsService
     */
    setVenueAsReturnToValue(venue: Venue): void {
        const values: ReturnToValues = {
            name: venue.venueInfo.name,
            latLng: new google.maps.LatLng(venue.anchor.coordinates[0], venue.anchor.coordinates[1]),
            isVenue: true
        };
        this.setReturnToValues(values);
    }

    /**
     * @description Returning the selected item name, lat lng and isVenue boolean.
     * @returns The return to values needed for button.
     * @memberof MapsIndoorsService
     */
    getReturnToValues(): Observable<ReturnToValues> {
        return this.returnToValues.asObservable();
    }
    // #endregion

    // #region || PAGE TITLE
    // Don't belong in here
    setPageTitle(title?: string): void {
        if (title) this.pageTitle.next(title);
        else if (this.appConfig.appSettings) this.pageTitle.next(this.appConfig.appSettings.title);
    }

    getCurrentPageTitle(): Observable<string> {
        return this.pageTitle.asObservable();
    }
    // #endregion

    /**
     * @description Only show locations passed along.
     * @param {Location[]} locations - Locations to show on map.
     * @param {boolean} [fitView=false] - Fit all visible locations into view.
     * @memberof MapsIndoorsService
     */
    public setMapFilter(locations: Location[], fitView: boolean = false): void {
        const locationIds = locations.map((location: Location): string => location.id);
        this.mapsIndoors.filter(locationIds, fitView);
    }

    /**
     * @description Fallback to original state with all locations shown.
     * @param {boolean} [fitView=false] - Fit all visible locations into view.
     * @memberof MapsIndoorsService
     */
    public clearMapFilter(fitView: boolean = false): void {
        this.mapsIndoors.filter(null, fitView);
    }
}