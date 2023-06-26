/**
 * External dependencies
 */
import jQuery from 'jquery'
import { debounce, isUndefined, intersection, isObject, isEmpty } from 'lodash'
import { Analyzer, Paper, Helpers } from '@rankMath/analyzer'

/**
 * WordPress dependencies
 */
import * as i18n from '@wordpress/i18n'
import { dispatch, select } from '@wordpress/data'
import { doAction, addAction, applyFilters, addFilter } from '@wordpress/hooks'
import getClassByScore from '@helpers/getClassByScore'
import apiFetch from '@wordpress/api-fetch'

/**
 * Internal dependencies
 */
import unescape from '@helpers/unescape'

class Assessor {
	/**
	 * Class constructor
	 *
	 * @param {Object} dataCollector DataCollector for assessment.
	 */
	constructor( dataCollector ) {
		this.analyzer = new Analyzer( {
			i18n,
			analyses: rankMath.assessor.researchesTests,
		} )
		this.dataCollector = dataCollector
		this.promises = []

		this.hooks()
		this.registerRefresh()
		this.saveEvent()
	}

	hooks() {
		this.updateKeywordResult = this.updateKeywordResult.bind( this )
		this.sanitizeData = this.sanitizeData.bind( this )
		this.addScoreElem = this.addScoreElem.bind( this )

		addAction(
			'rankMath_analysis_keywordUsage_updated',
			'rank-math',
			this.updateKeywordResult
		)

		addFilter(
			'rank_math_sanitize_meta_value',
			'rank-math',
			this.sanitizeData
		)

		addFilter(
			'rank_math_sanitize_data',
			'rank-math',
			this.sanitizeData
		)

		addAction( 'rank_math_loaded', 'rank-math', this.addScoreElem, 11 )
	}

	addScoreElem() {
		// Early bail if score is disabled or user doesn't have the required capabilities.
		if ( ! rankMath.showScore || ! rankMath.canUser.analysis || ! rankMath.canUser.general ) {
			return
		}

		setTimeout( () => {
			this.scoreText = '<span class="score-text"><span class="score-icon"><i class="rm-icon-rank-math"></i></span> SEO: <strong>Not available</strong></span>'
			this.scoreElem = jQuery(
				'<div class="misc-pub-section rank-math-seo-score">' +
					this.scoreText +
					'</div>'
			)
			this.scoreText = this.scoreElem.find( 'strong' )
			jQuery( '#misc-publishing-actions' ).append( this.scoreElem )

			this.fkScoreText = '<span class="score-text">Not available</span>'
			this.fkScoreElem = jQuery(
				'<div class="rank-math-seo-score below-focus-keyword">' +
					this.fkScoreText +
					'</div>'
			)
			this.fkScoreText = this.fkScoreElem.find( 'span' )
			jQuery( '#rank-math-metabox-wrapper .rank-math-focus-keyword' ).find( 'tags' ).parent( 'div' ).append( this.fkScoreElem )

			this.updateScore = this.updateScore.bind( this )

			this.updateScore()
			addAction( 'rank_math_refresh_results', 'rank-math', this.updateScore )
		}, 1500 )
	}

	updateScore() {
		const count = rankMathEditor.resultManager.getScore(
			rankMathEditor.getPrimaryKeyword()
		)
		const status = getClassByScore( count )

		this.scoreElem.removeClass( 'loading bad-fk ok-fk good-fk' )
		this.fkScoreElem.removeClass( 'loading bad-fk ok-fk good-fk' )
		this.scoreElem.addClass( status )
		this.fkScoreElem.addClass( status )
		this.scoreText.html( count + ' / 100' )
		this.fkScoreText.html( count + ' / 100' )
	}

	sanitizeData( value, key ) {
		// TODO: move it to helper itself
		if ( 'schemas' === key || isObject( value ) ) {
			return value
		}

		return isEmpty( value ) ? value : Helpers.sanitizeAppData( value )
	}

	getPaper( keyword, keywords ) {
		const gutenbergData = this.dataCollector.getData()
		const paper = new Paper( '', { locale: rankMath.localeFull } )

		paper.setTitle( select( 'rank-math' ).getSerpTitle() )
		paper.setPermalink( gutenbergData.slug )
		paper.setDescription( select( 'rank-math' ).getSerpDescription() )
		paper.setUrl( gutenbergData.permalink )
		paper.setText(
			unescape( applyFilters( 'rank_math_content', gutenbergData.content ) )
		)
		paper.setKeyword( keyword )
		paper.setKeywords( keywords )
		paper.setSchema( select( 'rank-math' ).getSchemas() )

		if ( ! isUndefined( gutenbergData.featuredImage ) ) {
			paper.setThumbnail( gutenbergData.featuredImage.source_url )
			paper.setThumbnailAltText(
				Helpers.removeDiacritics( gutenbergData.featuredImage.alt_text )
			)
		}

		if ( ! isEmpty( select( 'rank-math' ).getContentAIScore() ) || ! isEmpty( rankMath.ca_keyword ) ) {
			paper.setContentAI( true )
		}

		return paper
	}

	registerRefresh() {
		this.refresh = debounce( ( what ) => {
			if ( false === select( 'rank-math' ).isLoaded() ) {
				return
			}

			const keywords = select( 'rank-math' ).getKeywords().split( ',' )
			const promises = []
			doAction( 'rank_math_' + what + '_refresh' )

			/*eslint array-callback-return: 0*/
			keywords.map( ( keyword, index ) => {
				const paper = this.getPaper(
					Helpers.removeDiacritics( keyword ),
					keywords
				)

				const researches =
					0 === index
						? rankMath.assessor.researchesTests
						: this.filterTests( this.getSecondaryKeywordTests() )

				promises.push(
					this.analyzer
						.analyzeSome( researches, paper )
						.then( ( results ) => {
							rankMathEditor.resultManager.update(
								paper.getKeyword(),
								results,
								0 === index
							)

							if ( 0 === index ) {
								dispatch( 'rank-math' ).updateAnalysisScore(
									rankMathEditor.resultManager.getScore(
										paper.getKeyword()
									)
								)
							}
						} )
				)

				Promise.all( promises ).then( () => {
					dispatch( 'rank-math' ).refreshResults()
					this.refreshResults()
				} )
			} )
		}, 500 )
	}

	updateKeywordResult( keyword, result ) {
		rankMathEditor.resultManager.update( keyword, {
			keywordNotUsed: result,
		} )

		if ( keyword === rankMathEditor.getSelectedKeyword().toLowerCase() ) {
			dispatch( 'rank-math' ).refreshResults()
		}
	}

	getSecondaryKeywordTests() {
		return [
			'keywordInContent',
			'lengthContent',
			'keywordInSubheadings',
			'keywordDensity',
			'lengthPermalink',
			'linksHasExternals',
			'linksNotAllExternals',
			'linksHasInternal',
			'titleSentiment',
			'titleHasPowerWords',
			'titleHasNumber',
			'contentHasTOC',
			'contentHasShortParagraphs',
			'contentHasAssets',
		]
	}

	getPrimaryKeyword() {
		const keywords = select( 'rank-math' ).getKeywords()

		return Helpers.removeDiacritics( keywords.split( ',' )[ 0 ] )
	}

	getSelectedKeyword() {
		const keywords = select( 'rank-math' ).getKeywords()
		const selectedKeyword = select( 'rank-math' ).getSelectedKeyword()
		const keyword =
			'' !== selectedKeyword.data.value
				? selectedKeyword.data.value
				: keywords.split( ',' )[ 0 ]

		return Helpers.removeDiacritics( keyword )
	}

	/**
	 * Return the Research by name.
	 *
	 * @param {string} name The name to reference the research by.
	 *
	 * @return {*} Returns the result of the research or false if research does not exist.
	 */
	getResearch( name ) {
		return this.analyzer.researcher.getResearch( name )
	}

	refreshResults() {
		doAction( 'rank_math_refresh_results' )
	}

	/**
	 * Filter the Researcher tests.
	 *
	 * @param { Array } tests Tests.
	 *
	 * @return {Array} Filter Researches tests.
	 */
	filterTests( tests ) {
		return intersection( tests, rankMath.assessor.researchesTests )
	}

	saveEvent() {
		if ( isUndefined( this.dataCollector.form ) || isUndefined( this.dataCollector.updateBtn ) ) {
			return
		}
		let saveData = true
		this.dataCollector.form.on( 'submit', ( e ) => {
			if ( ! saveData ) {
				return
			}

			// The e.originalEvent is undefined when the "Preview Changes" button is clicked.
			if ( isUndefined( e.originalEvent ) ) {
				return
			}

			e.preventDefault()
			const saveBtn = this.dataCollector.updateBtn.data( 'disable' ) && this.dataCollector.saveDraft.length ? this.dataCollector.saveDraft : this.dataCollector.updateBtn
			saveBtn.addClass( 'disabled' ).parent().find( '.spinner' ).addClass( 'is-active' )
			saveData = false
			const promise1 = this.saveMeta()
			const promise2 = this.saveSchemas( promise1 )
			const promise3 = this.saveRedirection( promise2 )

			Promise.all( [ promise1, promise2, promise3 ] ).then( () => {
				saveBtn.removeClass( 'disabled' ).trigger( 'click' )
			} ).catch( () => {
				saveBtn.removeClass( 'disabled' ).trigger( 'click' )
			} )

			return false
		} )
	}

	saveMeta() {
		return new Promise( ( resolve ) => {
			const repo = select( 'rank-math' )
			const meta = repo.getDirtyMetadata()
			if ( isEmpty( meta ) ) {
				resolve( true )
				return
			}

			apiFetch( {
				method: 'POST',
				path: 'rankmath/v1/updateMeta',
				data: {
					objectID: rankMath.objectID,
					objectType: rankMath.objectType,
					meta,
					content: rankMathEditor.assessor.dataCollector.getContent(),
				},
			} ).then( () => {
				resolve( true )
			} ).catch( () => {
				resolve( true )
			} )
			dispatch( 'rank-math' ).resetDirtyMetadata()
		} )
	}

	/**
	 * Save redirection item.
	 *
	 * @param {Object} promise2
	 */
	saveRedirection( promise2 ) {
		return new Promise( async ( resolve ) => {
			await promise2
			const redirection = select( 'rank-math' ).getRedirectionItem()
			if ( isEmpty( redirection ) ) {
				resolve( true )
				return
			}

			redirection.objectID = window.rankMath.objectID
			redirection.objectType = window.rankMath.objectType
			redirection.redirectionSources = rankMathEditor.assessor.dataCollector.getData( 'permalink' )

			const rankMath = dispatch( 'rank-math' )
			const notices = dispatch( 'core/notices' )

			rankMath.resetRedirection()

			apiFetch( {
				method: 'POST',
				path: 'rankmath/v1/updateRedirection',
				data: redirection,
			} ).then( ( response ) => {
				if ( 'delete' === response.action ) {
					notices.createInfoNotice( response.message, {
						id: 'redirectionNotice',
					} )
					rankMath.updateRedirection( 'redirectionID', 0 )
				} else if ( 'update' === response.action ) {
					notices.createInfoNotice( response.message, {
						id: 'redirectionNotice',
					} )
				} else if ( 'new' === response.action ) {
					rankMath.updateRedirection( 'redirectionID', response.id )
					notices.createSuccessNotice( response.message, {
						id: 'redirectionNotice',
					} )
				}

				setTimeout( () => {
					notices.removeNotice( 'redirectionNotice' )
				}, 2000 )
				resolve( true )
			} ).catch( () => {
				resolve( true )
			} )
		} )
	}

	/**
	 * Save schema data.
	 *
	 * @param {Object} promise1
	 */
	saveSchemas( promise1 ) {
		return new Promise( async ( resolve ) => {
			await promise1
			const schemas = select( 'rank-math' ).getSchemas()
			if ( isEmpty( schemas ) || ! select( 'rank-math' ).hasSchemaUpdated() ) {
				resolve( true )
				return
			}

			apiFetch( {
				method: 'POST',
				path: 'rankmath/v1/updateSchemas',
				data: {
					objectID: rankMath.objectID,
					objectType: rankMath.objectType,
					schemas,
				},
			} ).then( () => {
				resolve( true )
			} ).catch( () => {
				resolve( true )
			} )
		} )
	}
}

export default Assessor
