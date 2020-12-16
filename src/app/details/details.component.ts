import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';
import { MatSidenav, MatDialog, MatDialogRef } from '@angular/material';
import { Router, ActivatedRoute } from '@angular/router';
import { AppConfigService } from '../services/app-config.service';
import { LocationService } from '../services/location.service';
import { MapsIndoorsService } from '../services/maps-indoors.service';
import { GoogleMapService } from '../services/google-map.service';
import { VenueService } from '../services/venue.service';
import { ShareUrlDialogComponent } from './share-url-dialog/share-url-dialog.component';
import { ThemeService } from '../services/theme.service';
import { SolutionService } from '../services/solution.service';
import { UserAgentService } from '../services/user-agent.service';
import { NotificationService } from '../services/notification.service';
import { TrackerService } from '../services/tracker.service';

import { Venue } from '../shared/models/venue.interface';
import { Location } from '../shared/models/location.interface';

@Component({
    selector: 'app-details',
    templateUrl: './details.component.html',
    styleUrls: ['./details.component.scss']
})
export class DetailsComponent implements OnInit, OnDestroy {
    isHandset: boolean;
    colors: {};
    venue: Venue;
    location: Location;
    displayAliases: boolean = false;

    loading: boolean = false;
    appConfig: any;

    dialogRef: MatDialogRef<ShareUrlDialogComponent>;
    appConfigSubscription: Subscription;
    locationSubscription: Subscription;
    dialogSubscription: Subscription;
    isHandsetSubscription: Subscription;
    themeServiceSubscription: Subscription;
    venueSubscription: Subscription;

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        public _ngZone: NgZone,
        private sidenav: MatSidenav,
        private userAgentService: UserAgentService,
        private themeService: ThemeService,
        private venueService: VenueService,
        private appConfigService: AppConfigService,
        private locationService: LocationService,
        private mapsIndoorsService: MapsIndoorsService,
        private solutionService: SolutionService,
        private googleMapService: GoogleMapService,
        private dialog: MatDialog,
        private notificationService: NotificationService,
        private trackerService: TrackerService
    ) {
        this.appConfigSubscription = this.appConfigService.getAppConfig().subscribe((appConfig) => this.appConfig = appConfig);
        this.themeServiceSubscription = this.themeService.getThemeColors().subscribe((appConfigColors) => this.colors = appConfigColors);
        this.locationSubscription = this.locationService.getCurrentLocation()
            .subscribe((location: Location) => {
                if (!Array.isArray(location.properties.categories)) {
                    location.properties.categories = Object.values(location.properties.categories);
                }
                this.location = location;
                this.googleMapService.openInfoWindow();
                this.mapsIndoorsService.setPageTitle(location.properties.name);
            });
        this.isHandsetSubscription = this.userAgentService.isHandset()
            .subscribe((value: boolean) => this.isHandset = value);
    }

    ngOnInit():void {
        this.venueSubscription = this.venueService.getVenueObservable()
            .subscribe((venue: Venue):void => {
                this.venue = venue;
                if (!this.location) { // True when user comes from a direct link
                    this.setLocation();
                }
            });

        this.displayAliases = this.appConfig.appSettings.displayAliases || false;
        window['angularComponentRef'] = { component: this, zone: this._ngZone };
    }

    // #region || LOCATION
    /**
	 * @description Gets and sets the location based on the URL id parameter
	 * @memberof DetailsComponent
	 * @private 
	 */
    private setLocation(): void {
        const id = this.route.snapshot.params.id;
        // Location id
        if (id.length === 24) { // TODO: find a better way to determine whether it is a locationId or an externalId
            this.locationService.getLocationById(id)
                .then((location: Location) => this.locationService.setLocation(location))
                .catch((err: Error): void => {
                    this.notificationService.displayNotification(err.message);
                    this.goBack();
                });
        } else {
        // Room (external) id
            this.locationService.getLocationByExternalId(id)
                .then((location: Location) => this.locationService.setLocation(location))
                .catch((err: Error): void => {
                    this.notificationService.displayNotification(err.message);
                    this.goBack();
                });
        }
    }

    /**
	 * @description Closing the sidebar
	 */
    public showOnMap(): void {
        this.sidenav.close();
        this.trackerService.sendEvent('Details page', 'Show on map button', 'Show on map button was clicked', true);
    }

    async getDirections(location: Location): Promise<void> {
        const solutionName = await this.solutionService.getSolutionName();
        const venueId = this.venue.id ? this.venue.id : this.route.snapshot.params.venueId;
        this.router.navigate([`${solutionName}/${venueId}/route/destination/${location.id}`]);
        this.trackerService.sendEvent('Directions', 'Clicked "Get Directions"', `"${location.properties.name}" - ${location.id}`);
    }
    // #endregion

    // #region || DESTROY
    /**
	 * @description Return to the previous page "Search-page".
	 * @returns {void}
	 * @memberof DetailsComponent
	 */
    goBack(): void {
        this.mapsIndoorsService.isMapDirty = false;
        this.mapsIndoorsService.setPageTitle();
        this.mapsIndoorsService.setVenueAsReturnToValue(this.venue);
        if (!this.locationService.getCategoryFilter()) {
            this.router.navigate([`${this.solutionService.getSolutionName()}/${this.venue.id}/search`]);
            return;
        }
        this.router.navigate([`${this.solutionService.getSolutionName()}/${this.venue.id}/search`], { queryParams: { cat: this.locationService.getCategoryFilter().categoryKey.toLowerCase() } });
    }

    ngOnDestroy(): void {
        this.mapsIndoorsService.mapsIndoors.location = null;
        this.mapsIndoorsService.clearMapFilter();
        window['angularComponentRef'] = null;
        this.googleMapService.closeInfoWindow();
        this.locationService.clearLocationPolygonHighlight();
        if (this.dialogSubscription) this.dialogSubscription.unsubscribe();
        this.locationSubscription.unsubscribe();
        this.appConfigSubscription.unsubscribe();
        this.themeServiceSubscription.unsubscribe();
        this.venueSubscription.unsubscribe();
        this.isHandsetSubscription.unsubscribe();
    }
    // #endregion

    // #region || DIALOG || SHARE DIALOG
    /**
     * @description Open share URL dialog.
     * @memberof DetailsComponent
     */
    public openShareUrlDialog(): void {
        this.dialogRef = this.dialog.open(ShareUrlDialogComponent, {
            width: '500px',
            autoFocus: true,
            disableClose: false,
            data: {
                url: window.location.href,
                locationName: this.location.properties.name
            }
        });

        this.dialogSubscription = this.dialogRef.afterClosed()
            .subscribe((): void => {
                this.trackerService.sendEvent('Details page', 'Share POI dialog', 'Close dialog button was clicked for Share POI', true);
            });
        this.trackerService.sendEvent('Details page', 'Share POI dialog', 'Opened share url dialog', true);
    }
    // #endregion
}
