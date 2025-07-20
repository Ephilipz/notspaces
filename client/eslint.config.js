import stylistic from '@stylistic/eslint-plugin'
import solid from 'eslint-plugin-solid/configs/recommended'

export default [
	solid,
	stylistic.configs.customize({
		indent: 'tab',
		jsx: true,
	}),
	{
		files: ['**/*.jsx'],
	},
]
